import { CompensationProfileService } from "../../application/accounting/compensation-profile.service";
import type {
  ExchangeRevaluationReadData,
  ExchangeRevaluationReader,
  RevaluationCollectionRow,
} from "../../application/reporting/exchange-revaluation.reader";
import type { RevaluationRateRef } from "../../domain/exchange-revaluation-policy";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";

const BASE_CURRENCY_KEY = "BASE_CURRENCY_ID";

/**
 * R5.5 — Lector Prisma remoto del informe de revaluación cambiaria.
 *
 * Gemelo del lector local; el remoto sirve varios gimnasios, así que no fija
 * el gym por env y pasa `gymId` a `businessDateForInstant`. La cadena de
 * «vivo al corte» y la resolución de la tasa vigente son idénticas.
 */
export class PrismaExchangeRevaluationReader
  implements ExchangeRevaluationReader
{
  private readonly profiles = new CompensationProfileService();

  async currentBusinessMonth(gymId: string): Promise<string> {
    const businessDate = await prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc()),
    );
    return businessDate.toISOString().slice(0, 7);
  }

  async read(
    gymId: string,
    cutoff: { month: string; endExclusive: Date },
  ): Promise<ExchangeRevaluationReadData> {
    const endExclusive = cutoff.endExclusive;
    const cutoffInstant = new Date(endExclusive.getTime() - 1);

    const baseConfig = await prisma.configuracionSistema.findUnique({
      where: { clave_gym_id: { clave: BASE_CURRENCY_KEY, gym_id: "GLOBAL" } },
    });
    const baseCurrencyId =
      baseConfig && !baseConfig.is_deleted ? baseConfig.valor : null;

    const currencies = await prisma.moneda.findMany({
      where: { is_deleted: false },
      select: { moneda_id: true, codigo: true },
    });
    const currencyCodes = new Map(
      currencies.map((row) => [row.moneda_id, row.codigo]),
    );

    if (!baseCurrencyId) {
      return {
        baseCurrencyId: null,
        currencyCodes,
        collections: [],
        cutoffRatesByCurrency: new Map(),
      };
    }

    // 1. Membresías vivas al corte: cubren el día de corte.
    const liveMemberships = await prisma.membresiaCliente.findMany({
      where: {
        gym_id: gymId,
        is_deleted: false,
        fecha_inicio: { lt: endExclusive },
        fecha_fin: { gte: endExclusive },
      },
      select: { membresia_id: true },
    });
    if (liveMemberships.length === 0) {
      return {
        baseCurrencyId,
        currencyCodes,
        collections: [],
        cutoffRatesByCurrency: new Map(),
      };
    }
    const liveMembershipIds = liveMemberships.map((row) => row.membresia_id);

    // 2. Cobros que financiaron esas membresías, cobrados hasta el corte.
    const applications = await prisma.pagoMembresiaAplicacion.findMany({
      where: { gym_id: gymId, membresia_id: { in: liveMembershipIds } },
      select: { pago_cliente_id: true },
    });
    const fundingPaymentIds = [
      ...new Set(applications.map((row) => row.pago_cliente_id)),
    ];
    if (fundingPaymentIds.length === 0) {
      return {
        baseCurrencyId,
        currencyCodes,
        collections: [],
        cutoffRatesByCurrency: new Map(),
      };
    }
    const payments = await prisma.pagoCliente.findMany({
      where: {
        pago_cliente_id: { in: fundingPaymentIds },
        gym_id: gymId,
        is_deleted: false,
        fecha: { lt: endExclusive },
      },
      select: { pago_cliente_id: true },
    });
    const collectedPaymentIds = payments.map((row) => row.pago_cliente_id);
    if (collectedPaymentIds.length === 0) {
      return {
        baseCurrencyId,
        currencyCodes,
        collections: [],
        cutoffRatesByCurrency: new Map(),
      };
    }

    // 3. Líneas de cobro en moneda débil con tasa congelada.
    const details = await prisma.detallePago.findMany({
      where: {
        pago_cliente_id: { in: collectedPaymentIds },
        gym_id: gymId,
        is_deleted: false,
        moneda_id: { not: baseCurrencyId },
        tipo_cambio_id: { not: null },
      },
      select: {
        detalle_pago_id: true,
        moneda_id: true,
        cantidad: true,
        tipo_cambio_id: true,
      },
    });
    if (details.length === 0) {
      return {
        baseCurrencyId,
        currencyCodes,
        collections: [],
        cutoffRatesByCurrency: new Map(),
      };
    }

    // 4. Tasas congeladas de esas líneas.
    const rateIds = [
      ...new Set(
        details
          .map((row) => row.tipo_cambio_id)
          .filter((id): id is string => id != null),
      ),
    ];
    const frozenRates = await prisma.tipoCambio.findMany({
      where: { tipo_cambio_id: { in: rateIds } },
      select: {
        tipo_cambio_id: true,
        moneda_id_base: true,
        moneda_id_target: true,
        exchange_rate: true,
      },
    });
    const rateById = new Map(
      frozenRates.map((row) => [row.tipo_cambio_id, row]),
    );

    const collections: RevaluationCollectionRow[] = [];
    const weakCurrencyIds = new Set<string>();
    for (const detail of details) {
      const rate = rateById.get(detail.tipo_cambio_id as string);
      if (!rate) continue;
      // La tasa congelada debe emparejar la moneda débil con la base; si no,
      // no se puede valuar de forma coherente y se omite.
      if (!pairsBaseWeak(rate, detail.moneda_id, baseCurrencyId)) continue;
      collections.push({
        reference: detail.detalle_pago_id,
        weakCurrencyId: detail.moneda_id,
        amount: detail.cantidad.toString(),
        collectionRate: toRateRef(rate),
      });
      weakCurrencyIds.add(detail.moneda_id);
    }

    // 5. Tasa vigente al corte por moneda débil (par base ↔ débil).
    const cutoffRatesByCurrency = await this.resolveCutoffRates(
      baseCurrencyId,
      [...weakCurrencyIds],
      cutoffInstant,
    );

    return {
      baseCurrencyId,
      currencyCodes,
      collections,
      cutoffRatesByCurrency,
    };
  }

  private async resolveCutoffRates(
    baseCurrencyId: string,
    weakCurrencyIds: string[],
    cutoffInstant: Date,
  ): Promise<Map<string, RevaluationRateRef>> {
    const result = new Map<string, RevaluationRateRef>();
    if (weakCurrencyIds.length === 0) return result;
    const candidates = await prisma.tipoCambio.findMany({
      where: {
        is_deleted: false,
        fecha_inicio: { lte: cutoffInstant },
        OR: [
          {
            moneda_id_base: baseCurrencyId,
            moneda_id_target: { in: weakCurrencyIds },
          },
          {
            moneda_id_base: { in: weakCurrencyIds },
            moneda_id_target: baseCurrencyId,
          },
        ],
      },
      orderBy: { fecha_inicio: "desc" },
      select: {
        moneda_id_base: true,
        moneda_id_target: true,
        exchange_rate: true,
        fecha_inicio: true,
        fecha_expiracion: true,
      },
    });
    for (const weakId of weakCurrencyIds) {
      const match = candidates.find(
        (row) =>
          pairsExact(row, baseCurrencyId, weakId) &&
          (row.fecha_expiracion === null ||
            row.fecha_expiracion.getTime() > cutoffInstant.getTime()),
      );
      if (match) result.set(weakId, toRateRef(match));
    }
    return result;
  }
}

function toRateRef(row: {
  moneda_id_base: string;
  moneda_id_target: string;
  exchange_rate: { toString(): string };
}): RevaluationRateRef {
  return {
    monedaIdBase: row.moneda_id_base,
    monedaIdTarget: row.moneda_id_target,
    exchangeRate: row.exchange_rate.toString(),
  };
}

function pairsBaseWeak(
  rate: { moneda_id_base: string; moneda_id_target: string },
  weakCurrencyId: string,
  baseCurrencyId: string,
): boolean {
  return (
    (rate.moneda_id_base === baseCurrencyId &&
      rate.moneda_id_target === weakCurrencyId) ||
    (rate.moneda_id_base === weakCurrencyId &&
      rate.moneda_id_target === baseCurrencyId)
  );
}

function pairsExact(
  rate: { moneda_id_base: string; moneda_id_target: string },
  baseCurrencyId: string,
  weakCurrencyId: string,
): boolean {
  return pairsBaseWeak(rate, weakCurrencyId, baseCurrencyId);
}
