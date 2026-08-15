import {
  surchargeBreakdown,
  surchargeBreakdownFromTotal,
} from "../../domain/exchange-rate-surcharge-policy";
import {
  effectiveSurchargeVersion,
  readRateSurchargeScope,
} from "./rate-surcharge-scope.service";
import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "../../domain/treasury-ledger-policy";

export const METHOD_SURCHARGE_POLICY = "R51-A-CEIL-V1";

export class MethodSurchargeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "MethodSurchargeError";
  }
}

export interface MethodSurchargeInput {
  baseAmount?: unknown;
  receivedAmount?: unknown;
  paymentTypeId: string;
  accountId: string;
  paymentCurrencyId: string;
  planCurrencyId: string;
  exchangeRateId?: string | null;
  exchangeRateVersion?: number | null;
  totalAmount?: unknown;
  confirmation?: boolean;
}

function money(value: unknown, label: string) {
  try {
    return treasuryMinorToMoney(treasuryMoneyToMinor(String(value ?? "")));
  } catch {
    throw new MethodSurchargeError(`${label} debe ser un importe decimal válido.`);
  }
}

export async function quoteMethodSurcharge(
  tx: any,
  input: MethodSurchargeInput,
  gymId: string,
  occurredAt: Date,
) {
  const [account, paymentType] = await Promise.all([
    tx.cuenta.findFirst({
      where: { cuenta_id: input.accountId, gym_id: gymId, is_deleted: false },
    }),
    tx.tipoPago.findUnique({ where: { tipo_pago_id: input.paymentTypeId } }),
  ]);
  if (!account) {
    throw new MethodSurchargeError("La cuenta no pertenece al gimnasio autenticado.", 403);
  }
  if (!paymentType || paymentType.is_deleted || !paymentType.activo) {
    throw new MethodSurchargeError("El método de pago no está disponible.");
  }
  if (account.moneda_id !== input.paymentCurrencyId) {
    throw new MethodSurchargeError("La moneda del detalle no coincide con su cuenta.");
  }
  if (account.tipo_pago_id && account.tipo_pago_id !== input.paymentTypeId) {
    throw new MethodSurchargeError("La cuenta no corresponde al método de pago elegido.");
  }

  let rate: any = null;
  let operation: "UNO_A_UNO" | "MULTIPLICAR" | "DIVIDIR" = "UNO_A_UNO";
  let factor = 1;
  if (input.paymentCurrencyId !== input.planCurrencyId) {
    if (!input.exchangeRateId) {
      throw new MethodSurchargeError("El cambio de moneda exige una tasa vigente.");
    }
    rate = await tx.tipoCambio.findUnique({
      where: { tipo_cambio_id: input.exchangeRateId },
    });
    if (!rate || rate.is_deleted || !rate.activo) {
      throw new MethodSurchargeError("La tasa de cambio no está disponible.");
    }
    if (occurredAt < new Date(rate.fecha_inicio) ||
        (rate.fecha_expiracion && occurredAt > new Date(rate.fecha_expiracion))) {
      throw new MethodSurchargeError("La tasa de cambio no está vigente.", 409);
    }
    if (rate.moneda_id_base === input.paymentCurrencyId &&
        rate.moneda_id_target === input.planCurrencyId) {
      operation = "MULTIPLICAR";
      factor = Number(rate.exchange_rate);
    } else if (rate.moneda_id_target === input.paymentCurrencyId &&
        rate.moneda_id_base === input.planCurrencyId) {
      operation = "DIVIDIR";
      factor = 1 / Number(rate.exchange_rate);
    } else {
      throw new MethodSurchargeError("La tasa no corresponde a las monedas del detalle y del plan.");
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new MethodSurchargeError("La tasa de cambio no tiene un valor utilizable.");
    }
  } else if (input.exchangeRateId) {
    throw new MethodSurchargeError("Un detalle 1:1 no debe enviar una tasa de cambio.");
  }

  const scoped = rate
    ? await readRateSurchargeScope(tx, rate, gymId)
    : {
        effective: {} as Record<string, string>,
        sources: {} as Record<string, "SEDE" | "GLOBAL">,
        versions: {} as Record<string, number>,
        source: "NINGUNO" as const,
      };
  const surcharges = scoped.effective;
  const breakdown = input.receivedAmount !== undefined
    ? surchargeBreakdownFromTotal(
        money(input.receivedAmount, "El total recibido"),
        surcharges,
        input.paymentTypeId,
      )
    : surchargeBreakdown(
        money(input.baseAmount, "La base del recargo"),
        surcharges,
        input.paymentTypeId,
      );
  const baseMinor = treasuryMoneyToMinor(breakdown.base);
  if (baseMinor <= 0n) {
    throw new MethodSurchargeError("La base del recargo debe ser mayor que cero.");
  }
  const hasSurcharge = breakdown.recargo_pct !== null;
  const quotedVersion = rate
    ? effectiveSurchargeVersion(Number(rate.version), scoped.versions[input.paymentTypeId])
    : null;
  if (input.confirmation && hasSurcharge) {
    if (input.exchangeRateVersion == null) {
      throw new MethodSurchargeError("La confirmación exige la versión cotizada de la tasa.", 409);
    }
    if (Number(input.exchangeRateVersion) !== quotedVersion) {
      throw new MethodSurchargeError("La tasa o sus recargos cambiaron; solicite una nueva cotización.", 409);
    }
  }
  if (input.totalAmount !== undefined) {
    const received = money(input.totalAmount, "El total recibido");
    if (treasuryMoneyToMinor(received) !== treasuryMoneyToMinor(breakdown.total)) {
      throw new MethodSurchargeError(
        `El total no coincide con la cotización vigente: debe ser ${breakdown.total}.`,
        409,
      );
    }
  }

  const equivalentMinor = BigInt(Math.round(Number(baseMinor) * factor));
  const grossEquivalentMinor = BigInt(Math.round(
    Number(treasuryMoneyToMinor(breakdown.total)) * factor,
  ));
  return {
    politica: METHOD_SURCHARGE_POLICY,
    moneda_pago_id: input.paymentCurrencyId,
    moneda_plan_id: input.planCurrencyId,
    tipo_cambio_id: rate?.tipo_cambio_id ?? null,
    tipo_cambio_version: quotedVersion,
    recargo_fuente: scoped.sources[input.paymentTypeId] ?? "NINGUNO",
    recargo_ambito_gym_id: scoped.sources[input.paymentTypeId] === "SEDE" ? gymId : null,
    operacion: operation,
    tasa: rate ? String(rate.exchange_rate) : "1",
    base: breakdown.base,
    porcentaje: breakdown.recargo_pct,
    recargo: breakdown.recargo,
    total: breakdown.total,
    equivalente_plan: treasuryMinorToMoney(equivalentMinor),
    equivalente_total_plan: treasuryMinorToMoney(grossEquivalentMinor),
    snapshot: hasSurcharge
      ? {
          recargo_metodo_base: breakdown.base,
          recargo_metodo_pct: breakdown.recargo_pct,
          recargo_metodo_importe: breakdown.recargo,
          recargo_metodo_total: breakdown.total,
          recargo_metodo_politica: METHOD_SURCHARGE_POLICY,
          // Desde M3 esta columna congela la versión efectiva tasa+política.
          recargo_metodo_tasa_version: quotedVersion,
        }
      : {
          recargo_metodo_base: null,
          recargo_metodo_pct: null,
          recargo_metodo_importe: null,
          recargo_metodo_total: null,
          recargo_metodo_politica: null,
          recargo_metodo_tasa_version: null,
        },
  };
}
