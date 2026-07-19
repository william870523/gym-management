import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  normalizeTreasuryManualIntent,
  normalizeTreasuryOperationId,
  normalizeTreasuryReconciliationIntent,
  parseTreasuryBusinessDate,
  parseTreasuryMonth,
  treasuryCloseAmounts,
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
  TreasuryLedgerPolicyError,
} from "../../domain/treasury-ledger-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { CompensationProfileService } from "./compensation-profile.service";
import { assertTreasuryMonthOpen } from "./treasury-month-lock.service";

type Tx = Prisma.TransactionClient;
type Direction = "ENTRADA" | "SALIDA";
type MovementDraft = {
  key: string;
  sourceType: string;
  sourceId: string;
  sourceDetailId?: string | null;
  direction: Direction;
  concept: string;
  accountId?: string | null;
  currencyId: string;
  paymentTypeId?: string | null;
  amount: string;
  occurredAt: Date;
  description?: string | null;
  counterMovementId?: string | null;
  review?: boolean;
  reviewReason?: string | null;
};

export class TreasuryLedgerError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "TreasuryLedgerError";
  }
}

export class TreasuryLedgerService {
  private readonly profiles = new CompensationProfileService();

  async dashboard(gymId: string, dateValue?: unknown) {
    const businessDate = dateValue
      ? this.policy(() => parseTreasuryBusinessDate(dateValue))
      : await prisma.$transaction((tx) =>
          this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())
        );
    return this.dashboardForDate(gymId, businessDate);
  }

  async monthly(gymId: string, monthValue?: unknown) {
    const period = monthValue
      ? this.policy(() => parseTreasuryMonth(monthValue))
      : await prisma.$transaction(async (tx) => {
          const businessDate = await this.profiles.businessDateForInstant(
            tx,
            gymId,
            trustedClock.nowUtc(),
          );
          return parseTreasuryMonth(businessDate.toISOString().slice(0, 7));
        });
    return this.monthlyForPeriod(gymId, period);
  }

  async manualOptions(gymId: string) {
    const [accounts, currencies, paymentTypes] = await Promise.all([
      prisma.cuenta.findMany({
        where: { gym_id: gymId, is_deleted: false },
        orderBy: { nombre_cuenta: "asc" },
      }),
      prisma.moneda.findMany({ where: { is_deleted: false } }),
      prisma.tipoPago.findMany({
        where: { activo: true, is_deleted: false },
        orderBy: { nombre_tipo_pago: "asc" },
      }),
    ]);
    const currencyById = new Map(
      currencies.map((row) => [row.moneda_id, row.codigo]),
    );
    return {
      cuentas: accounts.map((row) => ({
        cuenta_id: row.cuenta_id,
        nombre_cuenta: row.nombre_cuenta,
        moneda_id: row.moneda_id,
        moneda_codigo: currencyById.get(row.moneda_id) ?? row.moneda_id,
        tipo_pago_id: row.tipo_pago_id,
      })),
      tipos_pago: paymentTypes.map((row) => ({
        tipo_pago_id: row.tipo_pago_id,
        nombre_tipo_pago: row.nombre_tipo_pago,
      })),
    };
  }

  async createManual(input: {
    gymId: string;
    operationId: string;
    kind: unknown;
    concept: unknown;
    description?: unknown;
    evidence: unknown;
    amount: unknown;
    originAccountId?: unknown;
    destinationAccountId?: unknown;
    originPaymentTypeId?: unknown;
    destinationPaymentTypeId?: unknown;
    userId: string;
  }) {
    const operationId = this.policy(() =>
      normalizeTreasuryOperationId(input.operationId)
    );
    const intent = this.policy(() =>
      normalizeTreasuryManualIntent({
        kind: input.kind,
        concept: input.concept,
        description: input.description,
        evidence: input.evidence,
        amount: input.amount as any,
        originAccountId: input.originAccountId,
        destinationAccountId: input.destinationAccountId,
        originPaymentTypeId: input.originPaymentTypeId,
        destinationPaymentTypeId: input.destinationPaymentTypeId,
      })
    );
    const signature = this.manualSignature(intent);
    const repeated = await prisma.tesoreriaOperacionManual.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeated) {
      if (
        repeated.gym_id !== input.gymId ||
        repeated.intencion_firma !== signature
      ) {
        throw new TreasuryLedgerError(
          "Ese identificador de operación ya fue usado en otro movimiento.",
          409,
        );
      }
      return this.dashboardForDate(input.gymId, repeated.fecha_negocio);
    }

    const now = trustedClock.nowUtc();
    const businessDate = await prisma.$transaction(async (tx) => {
      const accountIds = [...new Set([
        intent.originAccountId,
        intent.destinationAccountId,
      ].filter((value): value is string => Boolean(value)))];
      const paymentTypeIds = [...new Set([
        intent.originPaymentTypeId,
        intent.destinationPaymentTypeId,
      ].filter((value): value is string => Boolean(value)))];
      const [accounts, paymentTypes, date, operatorName] = await Promise.all([
        tx.cuenta.findMany({
          where: {
            cuenta_id: { in: accountIds },
            gym_id: input.gymId,
            is_deleted: false,
          },
        }),
        tx.tipoPago.findMany({
          where: {
            tipo_pago_id: { in: paymentTypeIds },
            activo: true,
            is_deleted: false,
          },
        }),
        this.profiles.businessDateForInstant(tx, input.gymId, now),
        this.identityName(tx, input.gymId, input.userId),
      ]);
      const accountById = new Map(
        accounts.map((row) => [row.cuenta_id, row]),
      );
      const paymentTypeSet = new Set(
        paymentTypes.map((row) => row.tipo_pago_id),
      );
      if (accounts.length !== accountIds.length) {
        throw new TreasuryLedgerError(
          "Una de las cuentas ya no pertenece al gimnasio o no está disponible.",
          409,
        );
      }
      if (paymentTypes.length !== paymentTypeIds.length) {
        throw new TreasuryLedgerError(
          "Uno de los métodos de movimiento ya no está disponible.",
          409,
        );
      }
      const origin = intent.originAccountId
        ? accountById.get(intent.originAccountId)
        : null;
      const destination = intent.destinationAccountId
        ? accountById.get(intent.destinationAccountId)
        : null;
      if (
        intent.originPaymentTypeId &&
        (!paymentTypeSet.has(intent.originPaymentTypeId) ||
          (origin?.tipo_pago_id &&
            origin.tipo_pago_id !== intent.originPaymentTypeId))
      ) {
        throw new TreasuryLedgerError(
          "La cuenta de salida no corresponde al método seleccionado.",
          409,
        );
      }
      if (
        intent.destinationPaymentTypeId &&
        (!paymentTypeSet.has(intent.destinationPaymentTypeId) ||
          (destination?.tipo_pago_id &&
            destination.tipo_pago_id !== intent.destinationPaymentTypeId))
      ) {
        throw new TreasuryLedgerError(
          "La cuenta de entrada no corresponde al método seleccionado.",
          409,
        );
      }
      if (
        origin &&
        destination &&
        origin.moneda_id !== destination.moneda_id
      ) {
        throw new TreasuryLedgerError(
          "La transferencia manual solo admite cuentas de la misma moneda. Use el módulo de cambio para convertir divisas.",
          409,
        );
      }
      const currencyId = (origin ?? destination)?.moneda_id;
      if (!currencyId) {
        throw new TreasuryLedgerError(
          "No se pudo determinar la moneda del movimiento.",
          409,
        );
      }
      const manualId = randomUUID();
      const originKey = `MAN:${manualId}:ORIGEN`;
      const destinationKey = `MAN:${manualId}:DESTINO`;
      const movementIds: string[] = [];
      if (intent.originAccountId) {
        movementIds.push(this.movementId(input.gymId, originKey));
      }
      if (intent.destinationAccountId) {
        movementIds.push(this.movementId(input.gymId, destinationKey));
      }
      const summary = {
        version: 1,
        tipo: intent.kind,
        concepto: intent.concept,
        descripcion: intent.description,
        evidencia_referencia: intent.evidence,
        monto: intent.amount,
        moneda_id: currencyId,
        cuenta_origen_id: intent.originAccountId,
        cuenta_destino_id: intent.destinationAccountId,
        tipo_pago_origen_id: intent.originPaymentTypeId,
        tipo_pago_destino_id: intent.destinationPaymentTypeId,
        movimiento_ids: movementIds,
      };
      const manual = await tx.tesoreriaOperacionManual.create({
        data: {
          operacion_manual_id: manualId,
          operacion_id: operationId,
          intencion_firma: signature,
          comprobante_numero: this.manualReceiptNumber(date, manualId),
          tipo: intent.kind,
          concepto: intent.concept,
          descripcion: intent.description,
          evidencia_referencia: intent.evidence,
          cuenta_origen_id: intent.originAccountId,
          cuenta_destino_id: intent.destinationAccountId,
          tipo_pago_origen_id: intent.originPaymentTypeId,
          tipo_pago_destino_id: intent.destinationPaymentTypeId,
          moneda_id: currencyId,
          monto: intent.amount,
          fecha_negocio: date,
          registrada_por_user_id: input.userId,
          registrada_por_nombre_snapshot: operatorName,
          registrada_at: now,
          resumen_json: JSON.stringify(summary),
          is_deleted: false,
          created_at: now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.recordSync(
        tx,
        "tesoreria_operacion_manual",
        "INSERT",
        manual.operacion_manual_id,
        input.gymId,
        manual,
        operationId,
      );
      if (origin) {
        await this.createMovement(tx, input.gymId, {
          key: originKey,
          sourceType: "TESORERIA_MANUAL",
          sourceId: manualId,
          sourceDetailId: "ORIGEN",
          direction: "SALIDA",
          concept: `MANUAL_${intent.kind}`,
          accountId: origin.cuenta_id,
          currencyId,
          paymentTypeId: intent.originPaymentTypeId,
          amount: intent.amount,
          occurredAt: now,
          description: `${intent.concept} · ${intent.evidence}`,
        });
      }
      if (destination) {
        await this.createMovement(tx, input.gymId, {
          key: destinationKey,
          sourceType: "TESORERIA_MANUAL",
          sourceId: manualId,
          sourceDetailId: "DESTINO",
          direction: "ENTRADA",
          concept: `MANUAL_${intent.kind}`,
          accountId: destination.cuenta_id,
          currencyId,
          paymentTypeId: intent.destinationPaymentTypeId,
          amount: intent.amount,
          occurredAt: now,
          description: `${intent.concept} · ${intent.evidence}`,
        });
      }
      return date;
    }, { timeout: 30_000 });
    return this.dashboardForDate(input.gymId, businessDate);
  }

  async close(input: {
    gymId: string;
    operationId: string;
    businessDate: unknown;
    accountId: string;
    openingBalance?: unknown;
    countedBalance: unknown;
    userId: string;
  }) {
    const operationId = this.policy(() =>
      normalizeTreasuryOperationId(input.operationId)
    );
    const businessDate = this.policy(() =>
      parseTreasuryBusinessDate(input.businessDate)
    );
    const accountId = String(input.accountId ?? "").trim();
    if (!accountId) throw new TreasuryLedgerError("La cuenta es obligatoria.");
    const repeated = await prisma.tesoreriaCierre.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeated) {
      if (
        repeated.gym_id !== input.gymId ||
        repeated.cuenta_id !== accountId ||
        repeated.fecha_negocio.getTime() !== businessDate.getTime()
      ) {
        throw new TreasuryLedgerError(
          "Ese identificador de operación ya fue usado en otro cierre.",
          409,
        );
      }
      return this.dashboardForDate(input.gymId, businessDate);
    }
    const now = trustedClock.nowUtc();
    const today = await prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, input.gymId, now)
    );
    if (businessDate > today) {
      throw new TreasuryLedgerError(
        "No se puede cerrar una fecha comercial futura.",
        409,
      );
    }
    await prisma.$transaction(async (tx) => {
      await assertTreasuryMonthOpen(tx, input.gymId, businessDate);
      const account = await tx.cuenta.findFirst({
        where: {
          cuenta_id: accountId,
          gym_id: input.gymId,
          is_deleted: false,
        },
      });
      if (!account) {
        throw new TreasuryLedgerError(
          "La cuenta no pertenece al gimnasio o ya no está disponible.",
          404,
        );
      }
      const closeKey = this.closeKey(input.gymId, businessDate, accountId);
      if (await tx.tesoreriaCierre.findUnique({ where: { clave_cierre: closeKey } })) {
        throw new TreasuryLedgerError(
          "Esta cuenta ya tiene un cierre para la fecha seleccionada.",
          409,
        );
      }
      const movements = await tx.tesoreriaMovimiento.findMany({
        where: {
          gym_id: input.gymId,
          fecha_negocio: businessDate,
          cuenta_id: accountId,
          is_deleted: false,
        },
        orderBy: [{ ocurrido_at: "asc" }, { movimiento_id: "asc" }],
      });
      const review = movements.filter((row) => row.requiere_revision);
      if (review.length) {
        throw new TreasuryLedgerError(
          `Hay ${review.length} movimiento(s) que requieren revisión antes del cierre.`,
          409,
        );
      }
      const entriesMinor = this.sumDirection(movements, "ENTRADA");
      const exitsMinor = this.sumDirection(movements, "SALIDA");
      const previous = await tx.tesoreriaCierre.findFirst({
        where: {
          gym_id: input.gymId,
          cuenta_id: accountId,
          fecha_negocio: { lt: businessDate },
          is_deleted: false,
        },
        orderBy: [{ fecha_negocio: "desc" }, { cerrado_at: "desc" }],
      });
      const previousAdjusted = previous
        ? await this.adjustedCloseBalance(tx, input.gymId, previous)
        : "0";
      const amounts = this.policy(() =>
        treasuryCloseAmounts({
          opening: (input.openingBalance ?? previousAdjusted) as any,
          counted: input.countedBalance as any,
          entriesMinor,
          exitsMinor,
        })
      );
      const operatorName = await this.identityName(
        tx,
        input.gymId,
        input.userId,
      );
      const closeId = randomUUID();
      const lastMovementAt = movements.length
        ? movements[movements.length - 1]!.ocurrido_at
        : null;
      const close = await tx.tesoreriaCierre.create({
        data: {
          cierre_id: closeId,
          operacion_id: operationId,
          clave_cierre: closeKey,
          comprobante_numero: this.receiptNumber(businessDate, closeId),
          fecha_negocio: businessDate,
          cuenta_id: account.cuenta_id,
          moneda_id: account.moneda_id,
          saldo_inicial: amounts.opening,
          total_entradas: treasuryMinorToMoney(entriesMinor),
          total_salidas: treasuryMinorToMoney(exitsMinor),
          saldo_esperado: amounts.expected,
          saldo_contado: amounts.counted,
          diferencia: amounts.difference,
          movimientos_cantidad: movements.length,
          movimientos_hasta_at: lastMovementAt,
          cerrado_por_user_id: input.userId,
          cerrado_por_nombre_snapshot: operatorName,
          cerrado_at: now,
          snapshot_json: JSON.stringify({
            version: 1,
            fecha_negocio: businessDate.toISOString().slice(0, 10),
            cuenta_id: account.cuenta_id,
            moneda_id: account.moneda_id,
            movimiento_ids: movements.map((row) => row.movimiento_id),
            entradas: treasuryMinorToMoney(entriesMinor),
            salidas: treasuryMinorToMoney(exitsMinor),
            saldo_inicial: amounts.opening,
            saldo_esperado: amounts.expected,
            saldo_contado: amounts.counted,
            diferencia: amounts.difference,
          }),
          is_deleted: false,
          created_at: now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.recordSync(
        tx,
        "tesoreria_cierre",
        "INSERT",
        close.cierre_id,
        input.gymId,
        close,
        operationId,
      );
    }, { timeout: 30_000 });
    return this.dashboardForDate(input.gymId, businessDate);
  }

  async reconcile(input: {
    gymId: string;
    operationId: string;
    closeId: unknown;
    reason: unknown;
    evidence: unknown;
    userId: string;
  }) {
    const operationId = this.policy(() =>
      normalizeTreasuryOperationId(input.operationId)
    );
    const intent = this.policy(() =>
      normalizeTreasuryReconciliationIntent({
        closeId: input.closeId,
        reason: input.reason,
        evidence: input.evidence,
      })
    );
    const repeated = await prisma.tesoreriaConciliacion.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeated) {
      if (
        repeated.gym_id !== input.gymId ||
        repeated.cierre_id !== intent.closeId ||
        repeated.motivo !== intent.reason ||
        repeated.evidencia_referencia !== intent.evidence
      ) {
        throw new TreasuryLedgerError(
          "Ese identificador de operación ya fue usado en otra conciliación.",
          409,
        );
      }
      return this.dashboardForDate(input.gymId, repeated.fecha_negocio);
    }

    const now = trustedClock.nowUtc();
    const businessDate = await prisma.$transaction(async (tx) => {
      const close = await tx.tesoreriaCierre.findFirst({
        where: {
          cierre_id: intent.closeId,
          gym_id: input.gymId,
          is_deleted: false,
        },
      });
      if (!close) {
        throw new TreasuryLedgerError(
          "El cierre no pertenece al gimnasio o ya no está disponible.",
          404,
        );
      }
      await assertTreasuryMonthOpen(tx, input.gymId, close.fecha_negocio);
      const account = await tx.cuenta.findFirst({
        where: {
          cuenta_id: close.cuenta_id,
          gym_id: input.gymId,
          is_deleted: false,
        },
      });
      if (!account || account.moneda_id !== close.moneda_id) {
        throw new TreasuryLedgerError(
          "La cuenta o moneda del cierre ya no es válida.",
          409,
        );
      }
      const [movements, previousReconciliations, operatorName] =
        await Promise.all([
          tx.tesoreriaMovimiento.findMany({
            where: {
              gym_id: input.gymId,
              fecha_negocio: close.fecha_negocio,
              cuenta_id: close.cuenta_id,
              moneda_id: close.moneda_id,
              is_deleted: false,
            },
            orderBy: [{ ocurrido_at: "asc" }, { movimiento_id: "asc" }],
          }),
          tx.tesoreriaConciliacion.findMany({
            where: {
              gym_id: input.gymId,
              cierre_id: close.cierre_id,
              is_deleted: false,
            },
            orderBy: [{ registrada_at: "asc" }, { conciliacion_id: "asc" }],
          }),
          this.identityName(tx, input.gymId, input.userId),
        ]);
      const snapshot = this.snapshot(close.snapshot_json);
      const originalIds = new Set(
        Array.isArray(snapshot.movimiento_ids)
          ? snapshot.movimiento_ids.map(String)
          : [],
      );
      const reconciledIds = new Set<string>();
      for (const reconciliation of previousReconciliations) {
        for (const movementId of this.jsonIds(
          reconciliation.movimiento_ids_json,
        )) {
          reconciledIds.add(movementId);
        }
      }
      const late = movements.filter(
        (movement) =>
          !originalIds.has(movement.movimiento_id) &&
          !reconciledIds.has(movement.movimiento_id),
      );
      if (!late.length) {
        throw new TreasuryLedgerError(
          "Este cierre no tiene movimientos tardíos pendientes de conciliación.",
          409,
        );
      }
      const entriesMinor = this.sumDirection(late, "ENTRADA");
      const exitsMinor = this.sumDirection(late, "SALIDA");
      const adjustmentMinor = entriesMinor - exitsMinor;
      const previousAdjustmentMinor = previousReconciliations.reduce(
        (sum, row) =>
          sum + treasuryMoneyToMinor(this.money(row.ajuste_neto)),
        0n,
      );
      const originalBalanceMinor = treasuryMoneyToMinor(
        this.money(close.saldo_contado),
      );
      const adjustedBalanceMinor =
        originalBalanceMinor + previousAdjustmentMinor + adjustmentMinor;
      const movementIds = late.map((movement) => movement.movimiento_id);
      const intentSignature = this.reconciliationSignature(
        input.gymId,
        close.cierre_id,
        movementIds,
      );
      const reconciliationId = randomUUID();
      const summary = {
        version: 1,
        cierre_id: close.cierre_id,
        cierre_comprobante: close.comprobante_numero,
        fecha_negocio: close.fecha_negocio.toISOString().slice(0, 10),
        cuenta_id: close.cuenta_id,
        moneda_id: close.moneda_id,
        movimiento_ids: movementIds,
        movimientos_cantidad: movementIds.length,
        total_entradas: treasuryMinorToMoney(entriesMinor),
        total_salidas: treasuryMinorToMoney(exitsMinor),
        ajuste_neto: treasuryMinorToMoney(adjustmentMinor),
        saldo_cierre_original: treasuryMinorToMoney(originalBalanceMinor),
        saldo_ajustado: treasuryMinorToMoney(adjustedBalanceMinor),
        motivo: intent.reason,
        evidencia_referencia: intent.evidence,
      };
      const reconciliation = await tx.tesoreriaConciliacion.create({
        data: {
          conciliacion_id: reconciliationId,
          operacion_id: operationId,
          intencion_firma: intentSignature,
          comprobante_numero: this.reconciliationReceiptNumber(
            close.fecha_negocio,
            reconciliationId,
          ),
          cierre_id: close.cierre_id,
          fecha_negocio: close.fecha_negocio,
          cuenta_id: close.cuenta_id,
          moneda_id: close.moneda_id,
          movimiento_ids_json: JSON.stringify(movementIds),
          movimientos_cantidad: movementIds.length,
          total_entradas: treasuryMinorToMoney(entriesMinor),
          total_salidas: treasuryMinorToMoney(exitsMinor),
          ajuste_neto: treasuryMinorToMoney(adjustmentMinor),
          saldo_cierre_original: treasuryMinorToMoney(originalBalanceMinor),
          saldo_ajustado: treasuryMinorToMoney(adjustedBalanceMinor),
          motivo: intent.reason,
          evidencia_referencia: intent.evidence,
          registrada_por_user_id: input.userId,
          registrada_por_nombre_snapshot: operatorName,
          registrada_at: now,
          snapshot_json: JSON.stringify(summary),
          is_deleted: false,
          created_at: now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.recordSync(
        tx,
        "tesoreria_conciliacion",
        "INSERT",
        reconciliation.conciliacion_id,
        input.gymId,
        reconciliation,
        operationId,
      );
      return close.fecha_negocio;
    }, { timeout: 30_000 });
    return this.dashboardForDate(input.gymId, businessDate);
  }

  async recordPaymentInTx(
    tx: Tx,
    gymId: string,
    payment: any,
    details?: any[],
    options: { backfill?: boolean } = {},
  ) {
    const rows = details ?? await tx.detallePago.findMany({
      where: {
        pago_cliente_id: payment.pago_cliente_id,
        gym_id: gymId,
        is_deleted: false,
      },
      orderBy: [{ created_at: "asc" }, { detalle_pago_id: "asc" }],
    });
    if (!rows.length) {
      return this.createMovement(tx, gymId, {
        key: `PAGO:${payment.pago_cliente_id}:SIN_DETALLE`,
        sourceType: "PAGO_CLIENTE",
        sourceId: payment.pago_cliente_id,
        direction: "ENTRADA",
        concept: "PLAN_CLIENTE",
        currencyId: payment.moneda_id,
        amount: this.money(payment.monto_total),
        occurredAt: new Date(payment.fecha),
        description: `Cobro del socio ${payment.ci} sin detalle de cuenta.`,
        review: true,
        reviewReason: "COBRO_SIN_DETALLE_O_CUENTA",
      });
    }
    const rateIds = rows
      .map((row) => row.tipo_cambio_id)
      .filter((value): value is string => Boolean(value));
    const rates = rateIds.length
      ? await tx.tipoCambio.findMany({
          where: { tipo_cambio_id: { in: [...new Set(rateIds)] } },
        })
      : [];
    const rateById = new Map(rates.map((row) => [row.tipo_cambio_id, row]));
    let remainingBaseMinor = treasuryMoneyToMinor(this.money(payment.monto_total));
    const drafts: MovementDraft[] = [];
    let detectedChange = false;
    for (const detail of rows) {
      const grossMinor = treasuryMoneyToMinor(this.money(detail.cantidad));
      if (grossMinor <= 0n) continue;
      const conversion = this.detailConversion(
        detail,
        payment.moneda_id,
        rateById.get(detail.tipo_cambio_id),
      );
      const reasons: string[] = [];
      if (!detail.cuenta_id) reasons.push("MOVIMIENTO_SIN_CUENTA");
      if (!conversion.valid) reasons.push("TIPO_CAMBIO_NO_RESOLUBLE");
      const equivalentMinor = conversion.valid
        ? BigInt(Math.round(Number(grossMinor) * conversion.baseFactor))
        : 0n;
      const acceptedBaseMinor = equivalentMinor > remainingBaseMinor
        ? remainingBaseMinor
        : equivalentMinor;
      remainingBaseMinor = remainingBaseMinor > acceptedBaseMinor
        ? remainingBaseMinor - acceptedBaseMinor
        : 0n;
      const changeBaseMinor = equivalentMinor - acceptedBaseMinor;
      const entryKey = `PAGO:${detail.detalle_pago_id}`;
      drafts.push({
        key: entryKey,
        sourceType: "PAGO_CLIENTE",
        sourceId: payment.pago_cliente_id,
        sourceDetailId: detail.detalle_pago_id,
        direction: "ENTRADA",
        concept: "PLAN_CLIENTE",
        accountId: detail.cuenta_id,
        currencyId: detail.moneda_id,
        paymentTypeId: detail.tipo_pago_id,
        amount: treasuryMinorToMoney(grossMinor),
        occurredAt: new Date(payment.fecha),
        description: `Cobro de plan al socio ${payment.ci}.`,
        review: reasons.length > 0,
        reviewReason: reasons.join(", ") || null,
      });
      if (changeBaseMinor > 0n && conversion.valid) {
        detectedChange = true;
        const changeMinor = BigInt(
          Math.round(Number(changeBaseMinor) / conversion.baseFactor),
        );
        drafts.push({
          key: `PAGO_CAMBIO:${detail.detalle_pago_id}`,
          sourceType: "PAGO_CAMBIO",
          sourceId: payment.pago_cliente_id,
          sourceDetailId: detail.detalle_pago_id,
          direction: "SALIDA",
          concept: "CAMBIO_CLIENTE",
          accountId: detail.cuenta_id,
          currencyId: detail.moneda_id,
          paymentTypeId: detail.tipo_pago_id,
          amount: treasuryMinorToMoney(changeMinor),
          occurredAt: new Date(payment.fecha),
          description: `Cambio devuelto en el cobro del socio ${payment.ci}.`,
          counterMovementId: this.movementId(gymId, entryKey),
          review: !detail.cuenta_id,
          reviewReason: !detail.cuenta_id ? "CAMBIO_SIN_CUENTA" : null,
        });
      }
    }
    if (remainingBaseMinor > 1n && drafts.length) {
      const last = drafts[drafts.length - 1]!;
      last.review = true;
      last.reviewReason = [last.reviewReason, "DETALLES_NO_CUBREN_EL_IMPORTE_APLICADO"]
        .filter(Boolean)
        .join(", ");
    }
    if (options.backfill && detectedChange && rows.length > 1) {
      for (const draft of drafts) {
        draft.review = true;
        draft.reviewReason = [draft.reviewReason, "ORDEN_DE_CAMBIO_HISTORICO_ESTIMADO"]
          .filter(Boolean)
          .join(", ");
      }
    }
    let created = 0;
    for (const draft of drafts) {
      created += await this.createMovement(tx, gymId, draft);
    }
    return created;
  }

  async recordPaymentReversalInTx(tx: Tx, gymId: string, reversal: any) {
    const payment = await tx.pagoCliente.findFirst({
      where: { pago_cliente_id: reversal.pago_cliente_id, gym_id: gymId },
    });
    if (!payment) return 0;
    await this.recordPaymentInTx(tx, gymId, payment, undefined, {
      backfill: true,
    });
    const originals = await tx.tesoreriaMovimiento.findMany({
      where: {
        gym_id: gymId,
        origen_id: payment.pago_cliente_id,
        origen_tipo: { in: ["PAGO_CLIENTE", "PAGO_CAMBIO"] },
        is_deleted: false,
      },
      orderBy: { movimiento_id: "asc" },
    });
    let created = 0;
    for (const original of originals) {
      created += await this.createMovement(tx, gymId, {
        key: `PAGO_REV:${reversal.reversion_id}:${original.movimiento_id}`,
        sourceType: "PAGO_REVERSION",
        sourceId: reversal.reversion_id,
        sourceDetailId: original.origen_detalle_id,
        direction: original.direccion === "ENTRADA" ? "SALIDA" : "ENTRADA",
        concept: original.concepto === "CAMBIO_CLIENTE"
          ? "REVERSO_CAMBIO_CLIENTE"
          : "ANULACION_COBRO",
        accountId: original.cuenta_id,
        currencyId: original.moneda_id,
        paymentTypeId: original.tipo_pago_id,
        amount: this.money(original.monto),
        occurredAt: new Date(reversal.registrada_at),
        description: `Contramovimiento del cobro ${payment.pago_cliente_id}: ${reversal.motivo}`,
        counterMovementId: original.movimiento_id,
        review: original.requiere_revision,
        reviewReason: original.revision_motivo,
      });
    }
    return created;
  }

  async recordTrainerSettlementInTx(tx: Tx, gymId: string, settlement: any) {
    if (!settlement || !["PAGADA", "ANULADA"].includes(settlement.estado)) return 0;
    return this.createMovement(tx, gymId, {
      key: `LIQ:${settlement.liquidacion_id}`,
      sourceType: "LIQUIDACION_ENTRENADOR",
      sourceId: settlement.liquidacion_id,
      direction: "SALIDA",
      concept: settlement.tipo === "BAJA_FINAL"
        ? "LIQUIDACION_FINAL_ENTRENADOR"
        : "PAGO_ENTRENADOR",
      accountId: settlement.cuenta_id,
      currencyId: settlement.moneda_id,
      paymentTypeId: settlement.tipo_pago_id,
      amount: this.money(settlement.monto_total),
      occurredAt: new Date(settlement.pagada_at),
      description: `Liquidación ${settlement.comprobante_numero}.`,
      review: !settlement.cuenta_id,
      reviewReason: !settlement.cuenta_id ? "LIQUIDACION_SIN_CUENTA" : null,
    });
  }

  async recordTrainerSettlementReversalInTx(
    tx: Tx,
    gymId: string,
    reversal: any,
  ) {
    const settlement = await tx.entrenadorLiquidacion.findFirst({
      where: { liquidacion_id: reversal.liquidacion_id, gym_id: gymId },
    });
    if (!settlement) return 0;
    await this.recordTrainerSettlementInTx(tx, gymId, settlement);
    return this.createMovement(tx, gymId, {
      key: `LIQ_REV:${reversal.reversion_id}`,
      sourceType: "LIQUIDACION_REVERSION",
      sourceId: reversal.reversion_id,
      direction: "ENTRADA",
      concept: "REVERSO_PAGO_ENTRENADOR",
      accountId: settlement.cuenta_id,
      currencyId: settlement.moneda_id,
      paymentTypeId: settlement.tipo_pago_id,
      amount: this.money(reversal.monto_total),
      occurredAt: new Date(reversal.registrada_at),
      description: `Reversión de ${settlement.comprobante_numero}: ${reversal.motivo}`,
      counterMovementId: this.movementId(
        gymId,
        `LIQ:${settlement.liquidacion_id}`,
      ),
    });
  }

  async recordRefundInTx(tx: Tx, gymId: string, refund: any) {
    if (!refund || !["CONFIRMADO", "ANULADO"].includes(refund.estado)) return 0;
    return this.createMovement(tx, gymId, {
      key: `REEM:${refund.reembolso_id}`,
      sourceType: "REEMBOLSO_CLIENTE",
      sourceId: refund.reembolso_id,
      direction: "SALIDA",
      concept: "REEMBOLSO_CLIENTE",
      accountId: refund.cuenta_id,
      currencyId: refund.moneda_id,
      paymentTypeId: refund.tipo_pago_id,
      amount: this.money(refund.monto),
      occurredAt: new Date(refund.registrada_at),
      description: `Reembolso ${refund.comprobante_numero} al socio ${refund.ci}.`,
      review: !refund.cuenta_id,
      reviewReason: !refund.cuenta_id ? "REEMBOLSO_SIN_CUENTA" : null,
    });
  }

  async recordRefundReversalInTx(tx: Tx, gymId: string, reversal: any) {
    const refund = await tx.clienteReembolsoTesoreria.findFirst({
      where: { reembolso_id: reversal.reembolso_id, gym_id: gymId },
    });
    if (!refund) return 0;
    await this.recordRefundInTx(tx, gymId, refund);
    return this.createMovement(tx, gymId, {
      key: `REEM_REV:${reversal.reversion_id}`,
      sourceType: "REEMBOLSO_REVERSION",
      sourceId: reversal.reversion_id,
      direction: "ENTRADA",
      concept: "REVERSO_REEMBOLSO",
      accountId: refund.cuenta_id,
      currencyId: refund.moneda_id,
      paymentTypeId: refund.tipo_pago_id,
      amount: this.money(reversal.monto),
      occurredAt: new Date(reversal.registrada_at),
      description: `Reversión de ${refund.comprobante_numero}: ${reversal.motivo}`,
      counterMovementId: this.movementId(gymId, `REEM:${refund.reembolso_id}`),
    });
  }

  /**
   * R4.6: registra la salida de caja de un gasto devengado gobernado. El gasto
   * pertenece a un mes comercial, pero el dinero sale cuando se paga; este
   * movimiento refleja el flujo de caja, no el devengo.
   */
  async recordGastoGobernadoInTx(
    tx: Tx,
    gymId: string,
    payment: {
      aplicacion_id: string;
      gasto_id: string;
      moneda_id: string;
      cuenta_id: string | null;
      tipo_pago_id: string | null;
      monto: string;
      fecha_negocio: Date;
      descripcion: string;
    },
  ) {
    const key = `GASTO_PAGO:${payment.aplicacion_id}`;
    const movimiento_id = this.movementId(gymId, key);
    await this.createMovement(tx, gymId, {
      key,
      sourceType: "GASTO_GOBERNADO",
      sourceId: payment.gasto_id,
      sourceDetailId: payment.aplicacion_id,
      direction: "SALIDA",
      concept: "PAGO_GASTO_GOBERNADO",
      accountId: payment.cuenta_id,
      currencyId: payment.moneda_id,
      paymentTypeId: payment.tipo_pago_id,
      amount: this.money(payment.monto),
      occurredAt: payment.fecha_negocio,
      description: payment.descripcion,
      review: !payment.cuenta_id,
      reviewReason: !payment.cuenta_id ? "GASTO_SIN_CUENTA" : null,
    });
    return { movimiento_id };
  }

  /**
   * R4.6: revierte el pago de un gasto devengado creando un contramovimiento de
   * entrada. El movimiento original no se toca (libro append-only).
   */
  async recordGastoGobernadoReversalInTx(
    tx: Tx,
    gymId: string,
    reversal: {
      gasto_id: string;
      aplicacion_id: string;
      moneda_id: string;
      cuenta_id: string | null;
      tipo_pago_id: string | null;
      monto: string;
      fecha_negocio: Date;
      motivo: string;
      descripcion: string;
    },
  ) {
    const key = `GASTO_REV:${reversal.aplicacion_id}`;
    const movimiento_id = this.movementId(gymId, key);
    await this.createMovement(tx, gymId, {
      key,
      sourceType: "GASTO_GOBERNADO_REVERSION",
      sourceId: reversal.gasto_id,
      sourceDetailId: reversal.aplicacion_id,
      direction: "ENTRADA",
      concept: "REVERSION_GASTO_GOBERNADO",
      accountId: reversal.cuenta_id,
      currencyId: reversal.moneda_id,
      paymentTypeId: reversal.tipo_pago_id,
      amount: this.money(reversal.monto),
      occurredAt: reversal.fecha_negocio,
      description: reversal.descripcion,
      counterMovementId: this.movementId(gymId, `GASTO_PAGO:${reversal.aplicacion_id}`),
    });
    return { movimiento_id };
  }

  async backfill(gymId: string) {
    const [payments, paymentReversals, settlements, settlementReversals, refunds, refundReversals] =
      await Promise.all([
        prisma.pagoCliente.findMany({
          where: { gym_id: gymId },
          orderBy: [{ fecha: "asc" }, { pago_cliente_id: "asc" }],
        }),
        prisma.pagoReversion.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: { registrada_at: "asc" },
        }),
        prisma.entrenadorLiquidacion.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: { pagada_at: "asc" },
        }),
        prisma.entrenadorLiquidacionReversion.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: { registrada_at: "asc" },
        }),
        prisma.clienteReembolsoTesoreria.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: { registrada_at: "asc" },
        }),
        prisma.clienteReembolsoReversion.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: { registrada_at: "asc" },
        }),
      ]);
    let created = 0;
    for (const row of payments) {
      created += await prisma.$transaction((tx) =>
        this.recordPaymentInTx(tx, gymId, row, undefined, { backfill: true })
      );
    }
    for (const row of paymentReversals) {
      created += await prisma.$transaction((tx) =>
        this.recordPaymentReversalInTx(tx, gymId, row)
      );
    }
    for (const row of settlements) {
      created += await prisma.$transaction((tx) =>
        this.recordTrainerSettlementInTx(tx, gymId, row)
      );
    }
    for (const row of settlementReversals) {
      created += await prisma.$transaction((tx) =>
        this.recordTrainerSettlementReversalInTx(tx, gymId, row)
      );
    }
    for (const row of refunds) {
      created += await prisma.$transaction((tx) =>
        this.recordRefundInTx(tx, gymId, row)
      );
    }
    for (const row of refundReversals) {
      created += await prisma.$transaction((tx) =>
        this.recordRefundReversalInTx(tx, gymId, row)
      );
    }
    return { created };
  }

  private async monthlyForPeriod(
    gymId: string,
    period: { month: string; start: Date; endExclusive: Date },
  ) {
    const [
      movements,
      closesUntilEnd,
      reconciliationsUntilEnd,
      closeRequests,
      accounts,
      currencies,
    ] =
      await Promise.all([
        prisma.tesoreriaMovimiento.findMany({
          where: {
            gym_id: gymId,
            fecha_negocio: { gte: period.start, lt: period.endExclusive },
            is_deleted: false,
          },
          orderBy: [{ fecha_negocio: "asc" }, { ocurrido_at: "asc" }],
        }),
        prisma.tesoreriaCierre.findMany({
          where: {
            gym_id: gymId,
            fecha_negocio: { lt: period.endExclusive },
            is_deleted: false,
          },
          orderBy: [{ fecha_negocio: "asc" }, { cerrado_at: "asc" }],
        }),
        prisma.tesoreriaConciliacion.findMany({
          where: {
            gym_id: gymId,
            fecha_negocio: { lt: period.endExclusive },
            is_deleted: false,
          },
          orderBy: [{ fecha_negocio: "asc" }, { registrada_at: "asc" }],
        }),
        prisma.tesoreriaCierreSolicitud.findMany({
          where: {
            gym_id: gymId,
            fecha_negocio: { gte: period.start, lt: period.endExclusive },
            is_deleted: false,
          },
          orderBy: [{ fecha_negocio: "asc" }, { solicitada_at: "asc" }],
        }),
        prisma.cuenta.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: { nombre_cuenta: "asc" },
        }),
        prisma.moneda.findMany({ where: { is_deleted: false } }),
      ]);
    const dateKey = (value: Date) => new Date(value).toISOString().slice(0, 10);
    const inPeriod = (value: Date) => {
      const time = new Date(value).getTime();
      return time >= period.start.getTime() && time < period.endExclusive.getTime();
    };
    const monthCloses = closesUntilEnd.filter((row) => inPeriod(row.fecha_negocio));
    const monthReconciliations = reconciliationsUntilEnd.filter((row) =>
      inPeriod(row.fecha_negocio)
    );
    const currencyById = new Map(currencies.map((row) => [row.moneda_id, row]));
    const latestCloseByAccount = new Map<string, any>();
    const closeByAccountDate = new Map<string, any>();
    for (const close of closesUntilEnd) {
      latestCloseByAccount.set(close.cuenta_id, close);
      if (inPeriod(close.fecha_negocio)) {
        closeByAccountDate.set(
          `${close.cuenta_id}|${dateKey(close.fecha_negocio)}`,
          close,
        );
      }
    }
    const reconciliationsByClose = new Map<string, any[]>();
    for (const reconciliation of reconciliationsUntilEnd) {
      const rows = reconciliationsByClose.get(reconciliation.cierre_id) ?? [];
      rows.push(reconciliation);
      reconciliationsByClose.set(reconciliation.cierre_id, rows);
    }
    const movementsByAccount = new Map<string, any[]>();
    for (const movement of movements) {
      if (!movement.cuenta_id) continue;
      const rows = movementsByAccount.get(movement.cuenta_id) ?? [];
      rows.push(movement);
      movementsByAccount.set(movement.cuenta_id, rows);
    }
    const pendingRowsForClose = (close: any, rows: any[]) => {
      const snapshot = this.snapshot(close.snapshot_json);
      const snapshotIds = new Set(
        Array.isArray(snapshot.movimiento_ids)
          ? snapshot.movimiento_ids.map(String)
          : [],
      );
      const reconciledIds = new Set<string>();
      for (const reconciliation of reconciliationsByClose.get(close.cierre_id) ?? []) {
        for (const id of this.jsonIds(reconciliation.movimiento_ids_json)) {
          reconciledIds.add(id);
        }
      }
      const closeDate = dateKey(close.fecha_negocio);
      return rows.filter(
        (row) =>
          dateKey(row.fecha_negocio) === closeDate &&
          !snapshotIds.has(row.movimiento_id) &&
          !reconciledIds.has(row.movimiento_id),
      );
    };

    const accountRows = accounts
      .map((account) => {
        const rows = movementsByAccount.get(account.cuenta_id) ?? [];
        const closes = monthCloses.filter(
          (close) => close.cuenta_id === account.cuenta_id,
        );
        const requests = closeRequests.filter(
          (request) => request.cuenta_id === account.cuenta_id,
        );
        const pendingApprovalCount = requests.filter(
          (request) => request.estado === "PENDIENTE",
        ).length;
        const latestClose = latestCloseByAccount.get(account.cuenta_id) ?? null;
        if (
          rows.length === 0 &&
          closes.length === 0 &&
          requests.length === 0 &&
          !latestClose
        ) return null;
        const entries = this.sumDirection(rows, "ENTRADA");
        const exits = this.sumDirection(rows, "SALIDA");
        const activityDates = new Set(rows.map((row) => dateKey(row.fecha_negocio)));
        const closedActivityDays = [...activityDates].filter((date) =>
          closeByAccountDate.has(`${account.cuenta_id}|${date}`)
        ).length;
        const openDays = activityDates.size - closedActivityDays;
        const monthCloseIds = new Set(closes.map((close) => close.cierre_id));
        const reconciliations = monthReconciliations.filter((row) =>
          monthCloseIds.has(row.cierre_id)
        );
        const monthAdjustment = reconciliations.reduce(
          (sum, row) => sum + treasuryMoneyToMinor(this.money(row.ajuste_neto)),
          0n,
        );
        const pendingLate = closes.reduce(
          (sum, close) => sum + pendingRowsForClose(close, rows).length,
          0,
        );
        const latestReconciliations = latestClose
          ? reconciliationsByClose.get(latestClose.cierre_id) ?? []
          : [];
        const currentAdjustment = latestReconciliations.reduce(
          (sum, row) => sum + treasuryMoneyToMinor(this.money(row.ajuste_neto)),
          0n,
        );
        const originalBalance = latestClose
          ? treasuryMoneyToMinor(this.money(latestClose.saldo_contado))
          : null;
        const currentBalance = originalBalance == null
          ? null
          : originalBalance + currentAdjustment;
        const pendingAfterClose = latestClose
          ? rows.filter((row) => {
              const rowDate = dateKey(row.fecha_negocio);
              const closeDate = dateKey(latestClose.fecha_negocio);
              if (rowDate > closeDate) return true;
              if (rowDate < closeDate) return false;
              return pendingRowsForClose(latestClose, rows).some(
                (pending) => pending.movimiento_id === row.movimiento_id,
              );
            })
          : rows;
        const pendingEntries = this.sumDirection(pendingAfterClose, "ENTRADA");
        const pendingExits = this.sumDirection(pendingAfterClose, "SALIDA");
        const latestPending = latestClose && inPeriod(latestClose.fecha_negocio)
          ? pendingRowsForClose(latestClose, rows).length
          : 0;
        const status = pendingApprovalCount > 0
          ? "PENDIENTE_APROBACION"
          : openDays > 0
          ? "POR_CERRAR"
          : latestPending > 0
            ? "REQUIERE_CONCILIACION"
            : !latestClose
              ? "SIN_CIERRE"
              : latestReconciliations.length > 0
                ? "CONCILIADO"
                : "CERRADO";
        return {
          cuenta_id: account.cuenta_id,
          cuenta_nombre: account.nombre_cuenta,
          moneda_id: account.moneda_id,
          moneda_codigo:
            currencyById.get(account.moneda_id)?.codigo ?? account.moneda_id,
          entradas: treasuryMinorToMoney(entries),
          salidas: treasuryMinorToMoney(exits),
          neto: treasuryMinorToMoney(entries - exits),
          movimientos: rows.length,
          dias_actividad: activityDates.size,
          jornadas_cerradas: closedActivityDays,
          jornadas_por_cerrar: openDays,
          cierres: closes.length,
          cierres_aprobados: closes.filter(
            (close) => close.aprobacion_estado === "APROBADA",
          ).length,
          cierres_dentro_tolerancia: closes.filter(
            (close) => close.aprobacion_estado === "DENTRO_TOLERANCIA",
          ).length,
          solicitudes_pendientes: pendingApprovalCount,
          solicitudes_rechazadas: requests.filter(
            (request) => request.estado === "RECHAZADA",
          ).length,
          solicitudes_obsoletas: requests.filter(
            (request) => request.estado === "OBSOLETA",
          ).length,
          conciliaciones: reconciliations.length,
          ajustes_conciliados_mes: treasuryMinorToMoney(monthAdjustment),
          movimientos_conciliados: reconciliations.reduce(
            (sum, row) => sum + row.movimientos_cantidad,
            0,
          ),
          movimientos_tardios_pendientes: pendingLate,
          revisiones_pendientes: rows.filter((row) => row.requiere_revision).length,
          ultimo_cierre_fecha: latestClose ? dateKey(latestClose.fecha_negocio) : null,
          saldo_cierre_original:
            originalBalance == null ? null : treasuryMinorToMoney(originalBalance),
          ajustes_vigentes: latestClose
            ? treasuryMinorToMoney(currentAdjustment)
            : null,
          saldo_vigente:
            currentBalance == null ? null : treasuryMinorToMoney(currentBalance),
          neto_pendiente_cierre: treasuryMinorToMoney(
            pendingEntries - pendingExits,
          ),
          estado: status,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    const currencyIds = new Set<string>([
      ...movements.map((row) => row.moneda_id),
      ...accountRows.map((row) => row.moneda_id),
    ]);
    const currencyRows = [...currencyIds]
      .map((currencyId) => {
        const currencyMovements = movements.filter(
          (row) => row.moneda_id === currencyId,
        );
        const rows = accountRows.filter((row) => row.moneda_id === currencyId);
        const entries = this.sumDirection(currencyMovements, "ENTRADA");
        const exits = this.sumDirection(currencyMovements, "SALIDA");
        const originalBalance = rows.reduce(
          (sum, row) =>
            sum +
            (row.saldo_cierre_original == null
              ? 0n
              : treasuryMoneyToMinor(row.saldo_cierre_original)),
          0n,
        );
        const currentAdjustment = rows.reduce(
          (sum, row) =>
            sum +
            (row.ajustes_vigentes == null
              ? 0n
              : treasuryMoneyToMinor(row.ajustes_vigentes)),
          0n,
        );
        const activityDays = rows.reduce((sum, row) => sum + row.dias_actividad, 0);
        const closedDays = rows.reduce(
          (sum, row) => sum + row.jornadas_cerradas,
          0,
        );
        const trend: any[] = [];
        for (
          let cursor = period.start.getTime();
          cursor < period.endExclusive.getTime();
          cursor += 86_400_000
        ) {
          const day = new Date(cursor).toISOString().slice(0, 10);
          const dayMovements = currencyMovements.filter(
            (row) => dateKey(row.fecha_negocio) === day,
          );
          const dayEntries = this.sumDirection(dayMovements, "ENTRADA");
          const dayExits = this.sumDirection(dayMovements, "SALIDA");
          const dayCloses = monthCloses.filter(
            (row) => row.moneda_id === currencyId && dateKey(row.fecha_negocio) === day,
          );
          const dayCloseIds = new Set(dayCloses.map((row) => row.cierre_id));
          const dayAdjustments = monthReconciliations
            .filter((row) => dayCloseIds.has(row.cierre_id))
            .reduce(
              (sum, row) => sum + treasuryMoneyToMinor(this.money(row.ajuste_neto)),
              0n,
            );
          trend.push({
            fecha: day,
            entradas: treasuryMinorToMoney(dayEntries),
            salidas: treasuryMinorToMoney(dayExits),
            neto: treasuryMinorToMoney(dayEntries - dayExits),
            cierres: dayCloses.length,
            ajustes_conciliados: treasuryMinorToMoney(dayAdjustments),
          });
        }
        const orderedAccounts = [...rows].sort((left, right) => {
          const priority = (row: typeof left) =>
            row.jornadas_por_cerrar > 0 ||
              row.solicitudes_pendientes > 0 ||
              row.movimientos_tardios_pendientes > 0 ||
              row.revisiones_pendientes > 0
              ? 0
              : row.saldo_cierre_original == null
                ? 1
                : 2;
          const byPriority = priority(left) - priority(right);
          return byPriority !== 0
            ? byPriority
            : left.cuenta_nombre.localeCompare(right.cuenta_nombre);
        });
        return {
          moneda_id: currencyId,
          moneda_codigo: currencyById.get(currencyId)?.codigo ?? currencyId,
          entradas: treasuryMinorToMoney(entries),
          salidas: treasuryMinorToMoney(exits),
          neto: treasuryMinorToMoney(entries - exits),
          movimientos: currencyMovements.length,
          cuentas_con_actividad: rows.filter((row) => row.dias_actividad > 0).length,
          jornadas_actividad: activityDays,
          jornadas_cerradas: closedDays,
          jornadas_por_cerrar: activityDays - closedDays,
          cobertura_cierre: activityDays === 0
            ? 100
            : Number(((closedDays / activityDays) * 100).toFixed(1)),
          cierres: monthCloses.filter((row) => row.moneda_id === currencyId).length,
          cierres_aprobados: rows.reduce(
            (sum, row) => sum + row.cierres_aprobados,
            0,
          ),
          cierres_dentro_tolerancia: rows.reduce(
            (sum, row) => sum + row.cierres_dentro_tolerancia,
            0,
          ),
          solicitudes_pendientes: rows.reduce(
            (sum, row) => sum + row.solicitudes_pendientes,
            0,
          ),
          solicitudes_rechazadas: rows.reduce(
            (sum, row) => sum + row.solicitudes_rechazadas,
            0,
          ),
          solicitudes_obsoletas: rows.reduce(
            (sum, row) => sum + row.solicitudes_obsoletas,
            0,
          ),
          conciliaciones: rows.reduce((sum, row) => sum + row.conciliaciones, 0),
          ajustes_conciliados_mes: treasuryMinorToMoney(
            rows.reduce(
              (sum, row) => sum + treasuryMoneyToMinor(row.ajustes_conciliados_mes),
              0n,
            ),
          ),
          movimientos_conciliados: rows.reduce(
            (sum, row) => sum + row.movimientos_conciliados,
            0,
          ),
          movimientos_tardios_pendientes: rows.reduce(
            (sum, row) => sum + row.movimientos_tardios_pendientes,
            0,
          ),
          revisiones_pendientes: currencyMovements.filter(
            (row) => row.requiere_revision,
          ).length,
          movimientos_sin_cuenta: currencyMovements.filter(
            (row) => !row.cuenta_id,
          ).length,
          cuentas_sin_cierre: rows.filter(
            (row) => row.dias_actividad > 0 && row.saldo_cierre_original == null,
          ).length,
          saldo_cierre_original: treasuryMinorToMoney(originalBalance),
          ajustes_vigentes: treasuryMinorToMoney(currentAdjustment),
          saldo_vigente: treasuryMinorToMoney(originalBalance + currentAdjustment),
          neto_pendiente_cierre: treasuryMinorToMoney(
            rows.reduce(
              (sum, row) => sum + treasuryMoneyToMinor(row.neto_pendiente_cierre),
              0n,
            ),
          ),
          tendencia: trend,
          cuentas: orderedAccounts,
        };
      })
      .sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo));
    return {
      mes: period.month,
      fecha_desde: period.start.toISOString().slice(0, 10),
      fecha_hasta: new Date(period.endExclusive.getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10),
      monedas: currencyRows,
    };
  }

  private async dashboardForDate(gymId: string, businessDate: Date) {
    const [
      movements,
      closes,
      reconciliations,
      manualOperations,
      accounts,
      currencies,
      paymentTypes,
    ] = await Promise.all([
      prisma.tesoreriaMovimiento.findMany({
        where: { gym_id: gymId, fecha_negocio: businessDate, is_deleted: false },
        orderBy: [{ ocurrido_at: "desc" }, { movimiento_id: "desc" }],
      }),
      prisma.tesoreriaCierre.findMany({
        where: { gym_id: gymId, fecha_negocio: businessDate, is_deleted: false },
      }),
      prisma.tesoreriaConciliacion.findMany({
        where: { gym_id: gymId, fecha_negocio: businessDate, is_deleted: false },
        orderBy: [{ registrada_at: "asc" }, { conciliacion_id: "asc" }],
      }),
      prisma.tesoreriaOperacionManual.findMany({
        where: {
          gym_id: gymId,
          fecha_negocio: businessDate,
          is_deleted: false,
        },
      }),
      prisma.cuenta.findMany({
        where: { gym_id: gymId, is_deleted: false },
        orderBy: { nombre_cuenta: "asc" },
      }),
      prisma.moneda.findMany({ where: { is_deleted: false } }),
      prisma.tipoPago.findMany({ where: { is_deleted: false } }),
    ]);
    const currencyById = new Map(currencies.map((row) => [row.moneda_id, row]));
    const accountById = new Map(accounts.map((row) => [row.cuenta_id, row]));
    const paymentTypeById = new Map(paymentTypes.map((row) => [row.tipo_pago_id, row]));
    const manualById = new Map(
      manualOperations.map((row) => [row.operacion_manual_id, row]),
    );
    const closeByAccount = new Map(closes.map((row) => [row.cuenta_id, row]));
    const lateMovementIds = new Set<string>();
    const reconciledMovementIds = new Set<string>();
    const reconciliationsByClose = new Map<string, any[]>();
    for (const reconciliation of reconciliations) {
      const rows = reconciliationsByClose.get(reconciliation.cierre_id) ?? [];
      rows.push(reconciliation);
      reconciliationsByClose.set(reconciliation.cierre_id, rows);
      for (const movementId of this.jsonIds(
        reconciliation.movimiento_ids_json,
      )) {
        reconciledMovementIds.add(movementId);
      }
    }
    const summaryByCurrency = new Map<string, { entries: bigint; exits: bigint; count: number }>();
    for (const row of movements) {
      const current = summaryByCurrency.get(row.moneda_id) ?? { entries: 0n, exits: 0n, count: 0 };
      const amount = treasuryMoneyToMinor(this.money(row.monto));
      if (row.direccion === "ENTRADA") current.entries += amount;
      else current.exits += amount;
      current.count++;
      summaryByCurrency.set(row.moneda_id, current);
    }
    const accountRows = await Promise.all(accounts.map(async (account) => {
      const rows = movements.filter((row) => row.cuenta_id === account.cuenta_id);
      const entries = this.sumDirection(rows, "ENTRADA");
      const exits = this.sumDirection(rows, "SALIDA");
      const previous = await prisma.tesoreriaCierre.findFirst({
        where: {
          gym_id: gymId,
          cuenta_id: account.cuenta_id,
          fecha_negocio: { lt: businessDate },
          is_deleted: false,
        },
        orderBy: [{ fecha_negocio: "desc" }, { cerrado_at: "desc" }],
      });
      const previousAdjusted = previous
        ? await this.adjustedCloseBalance(prisma as any, gymId, previous)
        : "0";
      const close = closeByAccount.get(account.cuenta_id) ?? null;
      const accountReconciliations = close
        ? reconciliationsByClose.get(close.cierre_id) ?? []
        : [];
      const accountReconciledIds = new Set<string>();
      for (const reconciliation of accountReconciliations) {
        for (const movementId of this.jsonIds(
          reconciliation.movimiento_ids_json,
        )) {
          accountReconciledIds.add(movementId);
        }
      }
      const snapshot = close ? this.snapshot(close.snapshot_json) : null;
      const snapshotIds = new Set(
        Array.isArray(snapshot?.movimiento_ids)
          ? snapshot.movimiento_ids.map(String)
          : [],
      );
      const late = close
        ? rows.filter(
            (row) =>
              !snapshotIds.has(row.movimiento_id) &&
              !accountReconciledIds.has(row.movimiento_id),
          )
        : [];
      for (const row of late) lateMovementIds.add(row.movimiento_id);
      const closeAdjusted = close
        ? this.adjustedBalanceFromRows(close, accountReconciliations)
        : null;
      return {
        cuenta_id: account.cuenta_id,
        cuenta_nombre: account.nombre_cuenta,
        moneda_id: account.moneda_id,
        moneda_codigo: currencyById.get(account.moneda_id)?.codigo ?? account.moneda_id,
        entradas: treasuryMinorToMoney(entries),
        salidas: treasuryMinorToMoney(exits),
        neto: treasuryMinorToMoney(entries - exits),
        movimientos: rows.length,
        revisiones: rows.filter((row) => row.requiere_revision).length,
        saldo_inicial_sugerido: previousAdjusted,
        estado: close
          ? late.length
            ? "REQUIERE_CONCILIACION"
            : accountReconciliations.length
              ? "CONCILIADO"
              : "CERRADO"
          : "ABIERTO",
        movimientos_tardios: late.length,
        movimientos_conciliados: accountReconciledIds.size,
        saldo_ajustado: closeAdjusted,
        conciliaciones: accountReconciliations.map((row) =>
          this.presentReconciliation(row)
        ),
        cierre: close ? this.presentClose(close) : null,
      };
    }));
    return {
      fecha_negocio: businessDate.toISOString().slice(0, 10),
      resumen_monedas: [...summaryByCurrency.entries()].map(([currencyId, value]) => ({
        moneda_id: currencyId,
        moneda_codigo: currencyById.get(currencyId)?.codigo ?? currencyId,
        entradas: treasuryMinorToMoney(value.entries),
        salidas: treasuryMinorToMoney(value.exits),
        neto: treasuryMinorToMoney(value.entries - value.exits),
        movimientos: value.count,
      })),
      cuentas: accountRows,
      movimientos: movements.map((row) => ({
        ...row,
        monto: this.money(row.monto),
        cuenta_nombre: row.cuenta_id
          ? accountById.get(row.cuenta_id)?.nombre_cuenta ?? row.cuenta_id
          : "Sin cuenta",
        moneda_codigo: currencyById.get(row.moneda_id)?.codigo ?? row.moneda_id,
        tipo_pago_nombre: row.tipo_pago_id
          ? paymentTypeById.get(row.tipo_pago_id)?.nombre_tipo_pago ?? row.tipo_pago_id
          : null,
        operacion_manual:
          row.origen_tipo === "TESORERIA_MANUAL"
            ? manualById.get(row.origen_id) ?? null
            : null,
        es_tardio: lateMovementIds.has(row.movimiento_id),
        es_conciliado: reconciledMovementIds.has(row.movimiento_id),
      })),
      incidencias: {
        sin_cuenta: movements.filter((row) => !row.cuenta_id).length,
        requieren_revision: movements.filter((row) => row.requiere_revision).length,
        movimientos_tardios: accountRows.reduce((sum, row) => sum + row.movimientos_tardios, 0),
      },
    };
  }

  private async createMovement(tx: Tx, gymId: string, draft: MovementDraft) {
    if (await tx.tesoreriaMovimiento.findUnique({
      where: { gym_id_clave_origen: { gym_id: gymId, clave_origen: draft.key } },
    })) return 0;
    const amountMinor = treasuryMoneyToMinor(draft.amount);
    if (amountMinor <= 0n) return 0;
    const businessDate = await this.profiles.businessDateForInstant(
      tx,
      gymId,
      draft.occurredAt,
    );
    await assertTreasuryMonthOpen(tx, gymId, businessDate);
    const now = trustedClock.nowUtc();
    const movement = await tx.tesoreriaMovimiento.create({
      data: {
        movimiento_id: this.movementId(gymId, draft.key),
        clave_origen: draft.key,
        origen_tipo: draft.sourceType,
        origen_id: draft.sourceId,
        origen_detalle_id: draft.sourceDetailId ?? null,
        direccion: draft.direction,
        concepto: draft.concept,
        cuenta_id: draft.accountId ?? null,
        moneda_id: draft.currencyId,
        tipo_pago_id: draft.paymentTypeId ?? null,
        monto: treasuryMinorToMoney(amountMinor),
        ocurrido_at: draft.occurredAt,
        fecha_negocio: businessDate,
        descripcion: draft.description ?? null,
        contramovimiento_de_id: draft.counterMovementId ?? null,
        requiere_revision: draft.review ?? false,
        revision_motivo: draft.reviewReason ?? null,
        is_deleted: false,
        created_at: now,
        gym_id: gymId,
        source_device: "WEB_ADMIN",
        version: 1,
        updated_at: now,
        deleted_at: null,
      },
    });
    await this.recordSync(
      tx,
      "tesoreria_movimiento",
      "INSERT",
      movement.movimiento_id,
      gymId,
      movement,
    );
    return 1;
  }

  private detailConversion(detail: any, baseCurrencyId: string, rate: any) {
    if (detail.moneda_id === baseCurrencyId) return { valid: true, baseFactor: 1 };
    const value = Number(rate?.exchange_rate ?? 0);
    if (!rate || !Number.isFinite(value) || value <= 0) return { valid: false, baseFactor: 0 };
    if (rate.moneda_id_base === baseCurrencyId && rate.moneda_id_target === detail.moneda_id) {
      return { valid: true, baseFactor: 1 / value };
    }
    if (rate.moneda_id_base === detail.moneda_id && rate.moneda_id_target === baseCurrencyId) {
      return { valid: true, baseFactor: value };
    }
    return { valid: false, baseFactor: 0 };
  }

  private sumDirection(rows: any[], direction: Direction): bigint {
    return rows
      .filter((row) => row.direccion === direction)
      .reduce((sum, row) => sum + treasuryMoneyToMinor(this.money(row.monto)), 0n);
  }

  private presentClose(close: any) {
    return {
      ...close,
      saldo_inicial: this.money(close.saldo_inicial),
      total_entradas: this.money(close.total_entradas),
      total_salidas: this.money(close.total_salidas),
      saldo_esperado: this.money(close.saldo_esperado),
      saldo_contado: this.money(close.saldo_contado),
      diferencia: this.money(close.diferencia),
    };
  }

  private presentReconciliation(reconciliation: any) {
    return {
      ...reconciliation,
      total_entradas: this.money(reconciliation.total_entradas),
      total_salidas: this.money(reconciliation.total_salidas),
      ajuste_neto: this.money(reconciliation.ajuste_neto),
      saldo_cierre_original: this.money(
        reconciliation.saldo_cierre_original,
      ),
      saldo_ajustado: this.money(reconciliation.saldo_ajustado),
      movimiento_ids: this.jsonIds(reconciliation.movimiento_ids_json),
    };
  }

  private adjustedBalanceFromRows(close: any, reconciliations: any[]) {
    const counted = treasuryMoneyToMinor(this.money(close.saldo_contado));
    const adjustment = reconciliations.reduce(
      (sum, row) => sum + treasuryMoneyToMinor(this.money(row.ajuste_neto)),
      0n,
    );
    return treasuryMinorToMoney(counted + adjustment);
  }

  private async adjustedCloseBalance(tx: any, gymId: string, close: any) {
    const reconciliations = await tx.tesoreriaConciliacion.findMany({
      where: {
        gym_id: gymId,
        cierre_id: close.cierre_id,
        is_deleted: false,
      },
    });
    return this.adjustedBalanceFromRows(close, reconciliations);
  }

  private jsonIds(value: string) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private snapshot(value: string) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private movementId(gymId: string, key: string) {
    return `tm-${createHash("sha256").update(`${gymId}|${key}`).digest("hex").slice(0, 32)}`;
  }
  private closeKey(gymId: string, date: Date, accountId: string) {
    return `${gymId}|${date.toISOString().slice(0, 10)}|${accountId}`;
  }
  private receiptNumber(date: Date, id: string) {
    return `CIE-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`;
  }
  private manualReceiptNumber(date: Date, id: string) {
    return `MOV-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${id
      .slice(0, 8)
      .toUpperCase()}`;
  }
  private reconciliationReceiptNumber(date: Date, id: string) {
    return `CON-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${id
      .slice(0, 8)
      .toUpperCase()}`;
  }
  private reconciliationSignature(
    gymId: string,
    closeId: string,
    movementIds: string[],
  ) {
    return createHash("sha256")
      .update(`${gymId}|${closeId}|${[...movementIds].sort().join("|")}`)
      .digest("hex");
  }
  private manualSignature(intent: ReturnType<typeof normalizeTreasuryManualIntent>) {
    return createHash("sha256")
      .update(JSON.stringify({
        ...intent,
        amountMinor: intent.amountMinor.toString(),
      }))
      .digest("hex");
  }
  private money(value: unknown) {
    if (value && typeof value === "object" && "toString" in value) {
      return (value as { toString(): string }).toString();
    }
    return Number(value ?? 0).toFixed(2);
  }
  private async identityName(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: { user_id: userId, gym_id: gymId, active: true, is_deleted: false },
    });
    if (!user) throw new TreasuryLedgerError("La cuenta operadora no es válida.", 403);
    return user.user_nombre;
  }
  private async recordSync(
    tx: Tx,
    entity: string,
    operation: string,
    entityId: string,
    gymId: string,
    payload: unknown,
    eventId: string = randomUUID(),
  ) {
    await tx.syncLog.create({
      data: {
        event_id: eventId,
        entidad: entity,
        operacion: operation,
        entidad_id: entityId,
        gym_id: gymId,
        device_id: null,
        payload_json: JSON.stringify(serialize(payload)),
      },
    });
  }
  private policy<T>(callback: () => T): T {
    try {
      return callback();
    } catch (error) {
      if (error instanceof TreasuryLedgerPolicyError) {
        throw new TreasuryLedgerError(error.message);
      }
      throw error;
    }
  }
}

export function asTreasuryLedgerError(error: unknown) {
  if (error instanceof TreasuryLedgerError) return error;
  if (error instanceof TreasuryLedgerPolicyError) {
    return new TreasuryLedgerError(error.message);
  }
  return null;
}
