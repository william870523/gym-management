import { createHash } from "crypto";
import {
  classifyOperationalMovement,
  OperationalResultsPolicyError,
} from "../../domain/operational-results-policy";
import { readOperationalResultsFromSignedSnapshot } from
  "../../domain/operational-results-certification-policy";
import {
  buildOperationalAnnualComparison,
  type OperationalAnnualMonthInput,
  OperationalResultsAnnualPolicyError,
  parseOperationalResultsYear,
} from "../../domain/operational-results-annual-policy";
import {
  classifyTrainerObligationAtCutoff,
  OperationalObligationsPolicyError,
  refundWasPendingAtCutoff,
} from "../../domain/operational-obligations-policy";
import {
  parseTreasuryMonth,
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
  TreasuryLedgerPolicyError,
} from "../../domain/treasury-ledger-policy";
import type {
  OperationalResultsReadData,
  OperationalResultsReader,
  OperationalMonthlyCloseReadRow,
} from "./operational-results.reader";

type CategoryTotals = {
  category: string;
  label: string;
  scope: string;
  entries: bigint;
  exits: bigint;
  effect: bigint;
  movements: number;
  requiresReview: boolean;
};

type Totals = {
  entries: bigint;
  exits: bigint;
  bookNet: bigint;
  operational: bigint;
  nonOperational: bigint;
  /** M4b: efectivo aquí, ingreso de otro. Fuera del resultado, a la vista. */
  byOthers: bigint;
  pendingClassificationEffect: bigint;
  movements: number;
  withoutAccount: number;
  sourceReview: number;
  pendingClassification: number;
  categories: Map<string, CategoryTotals>;
};

type TrainerObligationTotals = {
  trainerId: string;
  trainerName: string;
  earnedPending: bigint;
  futurePending: bigint;
  payableNow: bigint;
  concepts: number;
  overdueConcepts: number;
  commissionConcepts: number;
  fixedConcepts: number;
  nextScheduledDate: Date | null;
  requiresReview: number;
};

type CurrencyObligationTotals = {
  earnedPending: bigint;
  futurePending: bigint;
  payableNow: bigint;
  refundPending: bigint;
  overdueConcepts: number;
  requiresReview: number;
  trainers: Map<string, TrainerObligationTotals>;
  refunds: Array<{
    adjustmentId: string;
    clientId: string;
    clientName: string;
    amount: bigint;
    requestedAt: Date;
  }>;
};

export class OperationalResultsServiceError extends Error {
  constructor(message: string, readonly status: 400 | 403 = 400) {
    super(message);
    this.name = "OperationalResultsServiceError";
  }
}

export class OperationalResultsService {
  constructor(private readonly reader: OperationalResultsReader) {}

  async get(input: { gymId: string; month?: unknown }): Promise<Record<string, any>> {
    if (!input.gymId.trim()) {
      throw new OperationalResultsServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    const requestedMonth = String(input.month ?? "").trim()
      || await this.reader.currentBusinessMonth(input.gymId);
    const period = this.policy(() => parseTreasuryMonth(requestedMonth));
    const data = await this.reader.read(input.gymId, period);
    return this.certifiedSnapshot(period, data, input.gymId)
      ?? this.project(period, data);
  }

  async getAnnual(input: {
    gymId: string;
    year?: unknown;
  }): Promise<Record<string, any>> {
    if (!input.gymId.trim()) {
      throw new OperationalResultsServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    const currentBusinessMonth = await this.reader.currentBusinessMonth(
      input.gymId,
    );
    const year = this.policy(() => parseOperationalResultsYear(
      String(input.year ?? "").trim() || currentBusinessMonth.slice(0, 4),
    ));
    const closes = await this.reader.readMonthlyCloses(input.gymId, year);
    const latestByMonth = new Map<string, OperationalMonthlyCloseReadRow>();
    for (const close of [...closes].sort((a, b) =>
      b.closedAt.getTime() - a.closedAt.getTime()
    )) {
      if (!latestByMonth.has(close.month)) latestByMonth.set(close.month, close);
    }
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      return this.annualMonth(
        month,
        currentBusinessMonth,
        latestByMonth.get(month) ?? null,
        input.gymId,
      );
    });
    return this.policy(() => buildOperationalAnnualComparison({
      year,
      currentBusinessMonth,
      months,
    }));
  }

  private annualMonth(
    month: string,
    currentBusinessMonth: string,
    close: OperationalMonthlyCloseReadRow | null,
    gymId: string,
  ): OperationalAnnualMonthInput {
    if (!close) {
      if (month === currentBusinessMonth) {
        return { month, status: "EN_CURSO", reason: "Mes comercial en curso." };
      }
      if (month > currentBusinessMonth) {
        return { month, status: "FUTURO", reason: "Mes comercial futuro." };
      }
      return {
        month,
        status: "SIN_CIERRE",
        reason: "El mes terminó sin un cierre R3 certificado.",
      };
    }
    const evidence = {
      month,
      monthlyCloseId: close.monthlyCloseId,
      sha256: close.sha256,
      closedAt: close.closedAt.toISOString(),
    };
    if (close.state === "REABIERTO") {
      return {
        ...evidence,
        status: "REABIERTO",
        reason: "El último ciclo del mes fue reabierto y dejó de estar certificado.",
      };
    }
    if (close.state !== "CERRADO") {
      return {
        ...evidence,
        status: "SNAPSHOT_INCOMPATIBLE",
        reason: "El último ciclo tiene un estado no reconocido.",
      };
    }
    const actualHash = createHash("sha256").update(close.snapshotJson).digest("hex");
    if (actualHash !== close.sha256) {
      return {
        ...evidence,
        status: "INTEGRIDAD_INVALIDA",
        reason: "La huella SHA-256 del cierre no coincide con su snapshot.",
      };
    }
    let raw: Record<string, any>;
    try {
      raw = JSON.parse(close.snapshotJson) as Record<string, any>;
    } catch {
      return {
        ...evidence,
        status: "SNAPSHOT_INCOMPATIBLE",
        reason: "El snapshot firmado no contiene JSON válido.",
      };
    }
    if (Number(raw.version ?? 0) < 2) {
      return {
        ...evidence,
        status: "SNAPSHOT_ANTERIOR",
        reason: "El cierre certifica Tesorería, pero usa un snapshot anterior a R3.",
      };
    }
    const signed = readOperationalResultsFromSignedSnapshot({
      snapshotJson: close.snapshotJson,
      expectedHash: close.sha256,
      actualHash,
      gymId,
      month,
    });
    if (!signed) {
      return {
        ...evidence,
        status: "SNAPSHOT_INCOMPATIBLE",
        reason: "El snapshot no corresponde al gimnasio, mes o contrato R3 esperado.",
      };
    }
    return {
      ...evidence,
      status: "CERTIFICADO",
      reason: "Snapshot R3 certificado e íntegro.",
      result: signed.result,
    };
  }

  private certifiedSnapshot(
    period: { month: string },
    data: OperationalResultsReadData,
    gymId: string,
  ) {
    const close = data.monthlyClose;
    if (!close || close.state !== "CERRADO") return null;
    const actualHash = createHash("sha256").update(close.snapshotJson).digest("hex");
    const signed = readOperationalResultsFromSignedSnapshot({
      snapshotJson: close.snapshotJson,
      expectedHash: close.sha256,
      actualHash,
      gymId,
      month: period.month,
    });
    if (!signed) return null;
    const signer = signed.snapshot.firmado_por ?? {};
    return {
      ...signed.result,
      estado_periodo: "CERTIFICADO",
      certificado: true,
      cierre_tesoreria: {
        cierre_mensual_id: close.monthlyCloseId,
        estado: close.state,
        resumen_sha256: close.sha256,
        integridad_verificada: true,
        snapshot_version: Number(signed.snapshot.version),
        cerrado_at: close.closedAt.toISOString(),
        reabierto_at: null,
        firmado_por_nombre: String(signer.nombre ?? ""),
        firmado_por_rol: String(signer.rol ?? ""),
        motivo: String(signed.snapshot.motivo ?? ""),
        timezone: String(signed.snapshot.timezone ?? "Etc/UTC"),
        generado_at_utc: String(signed.snapshot.generado_at_utc ?? ""),
      },
      nota_certificacion:
        "Resultado congelado dentro del cierre mensual; la huella SHA-256 fue verificada.",
    };
  }

  private project(
    period: { month: string; start: Date; endExclusive: Date },
    data: OperationalResultsReadData,
  ) {
    const accountById = new Map(data.accounts.map((row) => [row.accountId, row]));
    const currencyById = new Map(
      data.currencies.map((row) => [row.currencyId, row.code]),
    );
    const byCurrency = new Map<string, Totals>();
    const accountsByCurrency = new Map<string, Map<string, Totals>>();
    const activityByCurrency = new Map<string, Set<string>>();
    const obligationsByCurrency = new Map<string, CurrencyObligationTotals>();
    const businessEndExclusive = data.businessDate
      ? new Date(data.businessDate.getTime() + 86_400_000)
      : null;
    const obligationsAvailable = businessEndExclusive != null &&
      period.start.getTime() < businessEndExclusive.getTime();
    const cutoffExclusive = obligationsAvailable
      ? new Date(Math.min(period.endExclusive.getTime(), businessEndExclusive!.getTime()))
      : null;

    for (const movement of data.movements) {
      const currency = this.totals(byCurrency, movement.currencyId);
      const accountKey = movement.accountId ?? "__SIN_CUENTA__";
      const accountMap = this.nestedTotals(accountsByCurrency, movement.currencyId);
      const account = this.totals(accountMap, accountKey);
      const amountMinor = this.policy(() => treasuryMoneyToMinor(movement.amount));
      const classification = this.policy(() => classifyOperationalMovement({
        concept: movement.concept,
        sourceType: movement.sourceType,
        direction: movement.direction,
        amountMinor,
      }));
      this.add(currency, movement, amountMinor, classification);
      this.add(account, movement, amountMinor, classification);
      const activity = activityByCurrency.get(movement.currencyId) ?? new Set<string>();
      if (movement.accountId) {
        activity.add(
          `${movement.accountId}|${movement.businessDate.toISOString().slice(0, 10)}`,
        );
      }
      activityByCurrency.set(movement.currencyId, activity);
    }

    const closedKeysByCurrency = new Map<string, Set<string>>();
    for (const close of data.dailyCloses) {
      const keys = closedKeysByCurrency.get(close.currencyId) ?? new Set<string>();
      keys.add(`${close.accountId}|${close.businessDate.toISOString().slice(0, 10)}`);
      closedKeysByCurrency.set(close.currencyId, keys);
      this.totals(byCurrency, close.currencyId);
    }

    if (cutoffExclusive) {
      for (const row of data.trainerObligations ?? []) {
        const projection = this.policy(() => classifyTrainerObligationAtCutoff({
          totalMinor: treasuryMoneyToMinor(row.amount),
          earningMethod: row.earningMethod,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          scheduledDate: row.scheduledDate,
          state: row.state,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          applications: row.applications.map((application) => ({
            amountMinor: treasuryMoneyToMinor(application.amount),
            state: application.state,
            createdAt: application.createdAt,
            updatedAt: application.updatedAt,
          })),
        }, cutoffExclusive));
        if (!projection.existed) continue;
        this.totals(byCurrency, row.currencyId);
        const currency = this.obligationTotals(obligationsByCurrency, row.currencyId);
        currency.earnedPending += projection.earnedPendingMinor;
        currency.futurePending += projection.futurePendingMinor;
        currency.payableNow += projection.payableNowMinor;
        currency.overdueConcepts += projection.overdue ? 1 : 0;
        currency.requiresReview += projection.requiresReview ? 1 : 0;
        const trainer = this.trainerTotals(currency, row.trainerId, row.trainerName);
        trainer.earnedPending += projection.earnedPendingMinor;
        trainer.futurePending += projection.futurePendingMinor;
        trainer.payableNow += projection.payableNowMinor;
        trainer.concepts += 1;
        trainer.overdueConcepts += projection.overdue ? 1 : 0;
        trainer.commissionConcepts += row.source === "COMISION" ? 1 : 0;
        trainer.fixedConcepts += row.source === "FIJO" ? 1 : 0;
        trainer.requiresReview += projection.requiresReview ? 1 : 0;
        if (
          projection.earnedPendingMinor + projection.futurePendingMinor > 0n &&
          (!trainer.nextScheduledDate ||
            row.scheduledDate.getTime() < trainer.nextScheduledDate.getTime())
        ) {
          trainer.nextScheduledDate = row.scheduledDate;
        }
      }

      for (const row of data.refundRequests ?? []) {
        const pending = this.policy(() => refundWasPendingAtCutoff({
          requestedAt: row.requestedAt,
          events: row.events,
        }, cutoffExclusive));
        if (!pending) continue;
        this.totals(byCurrency, row.currencyId);
        const currency = this.obligationTotals(obligationsByCurrency, row.currencyId);
        const amount = this.policy(() => treasuryMoneyToMinor(row.amount));
        currency.refundPending += amount;
        currency.refunds.push({
          adjustmentId: row.adjustmentId,
          clientId: row.clientId,
          clientName: row.clientName,
          amount,
          requestedAt: row.requestedAt,
        });
      }
    }

    const currencies = [...byCurrency.entries()]
      .map(([currencyId, totals]) => {
        const activity = activityByCurrency.get(currencyId) ?? new Set<string>();
        const closed = closedKeysByCurrency.get(currencyId) ?? new Set<string>();
        const openDays = [...activity].filter((key) => !closed.has(key)).length;
        const accountTotals = accountsByCurrency.get(currencyId) ?? new Map();
        return {
          moneda_id: currencyId,
          moneda_codigo: currencyById.get(currencyId) ?? currencyId,
          caja: this.cash(totals),
          obligaciones: this.obligations(
            currencyId,
            obligationsByCurrency.get(currencyId),
            obligationsAvailable,
            cutoffExclusive,
          ),
          conceptos: this.categoryRows(totals),
          cuentas: [...accountTotals.entries()]
            .map(([accountKey, account]) => {
              const configured = accountKey === "__SIN_CUENTA__"
                ? null
                : accountById.get(accountKey) ?? null;
              return {
                cuenta_id: configured?.accountId ?? null,
                cuenta_nombre: configured?.name ?? "Sin cuenta",
                entradas: treasuryMinorToMoney(account.entries),
                salidas: treasuryMinorToMoney(account.exits),
                neto_libro: treasuryMinorToMoney(account.bookNet),
                flujo_operativo: treasuryMinorToMoney(account.operational),
                movimientos: account.movements,
                requiere_revision:
                  account.sourceReview > 0 || account.pendingClassification > 0,
              };
            })
            .sort((left, right) => {
              if (left.requiere_revision !== right.requiere_revision) {
                return left.requiere_revision ? -1 : 1;
              }
              return left.cuenta_nombre.localeCompare(right.cuenta_nombre);
            }),
          calidad: {
            movimientos_sin_cuenta: totals.withoutAccount,
            clasificacion_pendiente: totals.pendingClassification,
            jornadas_por_cerrar: openDays,
            revisiones_pendientes: totals.sourceReview,
          },
        };
      })
      .sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo));

    const closeIntegrity = data.monthlyClose
      ? createHash("sha256").update(data.monthlyClose.snapshotJson).digest("hex") ===
        data.monthlyClose.sha256
      : null;
    const hasReview = currencies.some((row) =>
      row.calidad.clasificacion_pendiente > 0 ||
      row.calidad.revisiones_pendientes > 0 ||
      row.calidad.movimientos_sin_cuenta > 0 ||
      row.obligaciones.revisiones_pendientes > 0
    ) || (data.monthlyClose?.state === "CERRADO" && closeIntegrity === false);
    const reopened = data.monthlyClose?.state === "REABIERTO";
    const state = reopened
      ? "REABIERTO"
      : hasReview
        ? "REQUIERE_REVISION"
        : "PROVISIONAL";

    return {
      mes: period.month,
      estado_periodo: state,
      naturaleza: "RESULTADO_OPERATIVO_DE_CAJA",
      certificado: false,
      cierre_tesoreria: data.monthlyClose
        ? {
            cierre_mensual_id: data.monthlyClose.monthlyCloseId,
            estado: data.monthlyClose.state,
            resumen_sha256: data.monthlyClose.sha256,
            integridad_verificada: closeIntegrity,
            cerrado_at: data.monthlyClose.closedAt.toISOString(),
            reabierto_at: data.monthlyClose.reopenedAt?.toISOString() ?? null,
          }
        : null,
      nota_certificacion: data.monthlyClose?.state === "CERRADO"
        ? closeIntegrity === false
          ? "La firma del cierre de Tesorería no supera la verificación de integridad; el resultado no puede certificarse."
          : "El cierre existente usa un snapshot anterior a R3; Tesorería está firmada, pero este resultado continúa provisional."
        : "El resultado es una proyección de lectura y no sustituye el cierre firmado.",
      monedas: currencies,
      limitaciones: [
        "No representa utilidad ni ingreso devengado.",
        "No convierte ni suma monedas diferentes.",
        "Las obligaciones históricas son una reconstrucción provisional hasta incorporarlas al snapshot firmado en R3.",
        "El fondo futuro fijo solo incluye obligaciones ya materializadas; las comisiones futuras sí proceden de sus cuotas contractuales.",
      ],
    };
  }

  private add(
    totals: Totals,
    movement: OperationalResultsReadData["movements"][number],
    amountMinor: bigint,
    classification: ReturnType<typeof classifyOperationalMovement>,
  ) {
    const isEntry = movement.direction === "ENTRADA";
    totals.entries += isEntry ? amountMinor : 0n;
    totals.exits += isEntry ? 0n : amountMinor;
    totals.bookNet += isEntry ? amountMinor : -amountMinor;
    totals.movements += 1;
    if (!movement.accountId) totals.withoutAccount += 1;
    if (movement.requiresReview) totals.sourceReview += 1;
    if (classification.requiresReview) totals.pendingClassification += 1;
    if (classification.scope === "OPERATIVO") {
      totals.operational += classification.signedMinor;
    } else if (classification.scope === "NO_OPERATIVO") {
      totals.nonOperational += classification.signedMinor;
    } else if (classification.scope === "POR_CUENTA_AJENA") {
      // No entra en `operational`: es la línea que impide que el margen de esta
      // sede se infle con dinero que no ganó (§7.10).
      totals.byOthers += classification.signedMinor;
    } else if (classification.scope === "REVISAR") {
      totals.pendingClassificationEffect += classification.signedMinor;
    }
    const category = totals.categories.get(classification.category) ?? {
      category: classification.category,
      label: classification.label,
      scope: classification.scope,
      entries: 0n,
      exits: 0n,
      effect: 0n,
      movements: 0,
      requiresReview: false,
    };
    category.entries += isEntry ? amountMinor : 0n;
    category.exits += isEntry ? 0n : amountMinor;
    category.effect += classification.signedMinor;
    category.movements += 1;
    category.requiresReview ||= classification.requiresReview;
    totals.categories.set(classification.category, category);
  }

  private cash(totals: Totals) {
    const effect = (category: string) => totals.categories.get(category)?.effect ?? 0n;
    return {
      cobros_brutos: treasuryMinorToMoney(effect("COBROS_PLANES")),
      cambio_entregado_neto: treasuryMinorToMoney(-effect("CAMBIO_ENTREGADO")),
      anulaciones_netas: treasuryMinorToMoney(-effect("ANULACIONES_COBRO")),
      pagos_entrenadores_netos: treasuryMinorToMoney(-effect("PAGOS_ENTRENADORES")),
      reembolsos_netos: treasuryMinorToMoney(-effect("REEMBOLSOS_CLIENTES")),
      otros_egresos_operativos: treasuryMinorToMoney(-effect("GASTOS_MANUALES")),
      flujo_operativo: treasuryMinorToMoney(totals.operational),
      flujo_no_operativo: treasuryMinorToMoney(totals.nonOperational),
      cobrado_por_cuenta_ajena: treasuryMinorToMoney(totals.byOthers),
      flujo_pendiente_clasificacion: treasuryMinorToMoney(
        totals.pendingClassificationEffect,
      ),
      entradas_libro: treasuryMinorToMoney(totals.entries),
      salidas_libro: treasuryMinorToMoney(totals.exits),
      neto_libro: treasuryMinorToMoney(totals.bookNet),
    };
  }

  private categoryRows(totals: Totals) {
    const scopeOrder: Record<string, number> = {
      OPERATIVO: 0,
      REVISAR: 1,
      POR_CUENTA_AJENA: 2,
      NO_OPERATIVO: 3,
      NEUTRO: 4,
    };
    return [...totals.categories.values()]
      .map((row) => ({
        categoria: row.category,
        etiqueta: row.label,
        ambito: row.scope,
        entradas: treasuryMinorToMoney(row.entries),
        salidas: treasuryMinorToMoney(row.exits),
        efecto_flujo: treasuryMinorToMoney(row.effect),
        movimientos: row.movements,
        requiere_revision: row.requiresReview,
      }))
      .sort((left, right) =>
        (scopeOrder[left.ambito] ?? 9) - (scopeOrder[right.ambito] ?? 9)
        || left.etiqueta.localeCompare(right.etiqueta)
      );
  }

  private obligations(
    _currencyId: string,
    totals: CurrencyObligationTotals | undefined,
    available: boolean,
    cutoffExclusive: Date | null,
  ) {
    if (!available || !cutoffExclusive) {
      return {
        disponible: false,
        fecha_corte: null,
        entrenador_ganado_pendiente: null,
        entrenador_pagadero_ahora: null,
        entrenador_futuro: null,
        reembolsos_pendientes: null,
        reserva_inmediata: null,
        compromiso_total: null,
        entrenadores_pendientes: 0,
        cuotas_vencidas: 0,
        reembolsos_cantidad: 0,
        revisiones_pendientes: 0,
        entrenadores: [],
        reembolsos: [],
        motivo: "El mes seleccionado todavía no tiene una fecha de corte comercial.",
        cobertura_futuro:
          "Las comisiones futuras están cubiertas; el fijo futuro aparece al materializarse.",
      };
    }
    const current = totals ?? {
      earnedPending: 0n,
      futurePending: 0n,
      payableNow: 0n,
      refundPending: 0n,
      overdueConcepts: 0,
      requiresReview: 0,
      trainers: new Map<string, TrainerObligationTotals>(),
      refunds: [],
    };
    const trainers = [...current.trainers.values()]
      .filter((row) => row.earnedPending + row.futurePending > 0n)
      .map((row) => ({
        entrenador_id: row.trainerId,
        entrenador_nombre: row.trainerName,
        ganado_pendiente: treasuryMinorToMoney(row.earnedPending),
        pagadero_ahora: treasuryMinorToMoney(row.payableNow),
        futuro: treasuryMinorToMoney(row.futurePending),
        conceptos: row.concepts,
        conceptos_vencidos: row.overdueConcepts,
        conceptos_comision: row.commissionConcepts,
        conceptos_fijos: row.fixedConcepts,
        proxima_fecha_pago:
          row.nextScheduledDate?.toISOString().slice(0, 10) ?? null,
        requiere_revision: row.requiresReview > 0,
      }))
      .sort((left, right) =>
        treasuryMoneyToMinor(right.pagadero_ahora) >
            treasuryMoneyToMinor(left.pagadero_ahora)
          ? 1
          : treasuryMoneyToMinor(right.pagadero_ahora) <
              treasuryMoneyToMinor(left.pagadero_ahora)
            ? -1
            : left.entrenador_nombre.localeCompare(right.entrenador_nombre)
      );
    const refunds = [...current.refunds]
      .sort((left, right) =>
        left.requestedAt.getTime() - right.requestedAt.getTime() ||
        left.adjustmentId.localeCompare(right.adjustmentId)
      )
      .map((row) => ({
        ajuste_financiero_id: row.adjustmentId,
        ci: row.clientId,
        cliente_nombre: row.clientName,
        monto: treasuryMinorToMoney(row.amount),
        solicitado_at: row.requestedAt.toISOString(),
      }));
    const immediateReserve = current.earnedPending + current.refundPending;
    return {
      disponible: true,
      fecha_corte: new Date(cutoffExclusive.getTime() - 86_400_000)
        .toISOString().slice(0, 10),
      entrenador_ganado_pendiente: treasuryMinorToMoney(current.earnedPending),
      entrenador_pagadero_ahora: treasuryMinorToMoney(current.payableNow),
      entrenador_futuro: treasuryMinorToMoney(current.futurePending),
      reembolsos_pendientes: treasuryMinorToMoney(current.refundPending),
      reserva_inmediata: treasuryMinorToMoney(immediateReserve),
      compromiso_total: treasuryMinorToMoney(
        immediateReserve + current.futurePending,
      ),
      entrenadores_pendientes: trainers.length,
      cuotas_vencidas: current.overdueConcepts,
      reembolsos_cantidad: refunds.length,
      revisiones_pendientes: current.requiresReview,
      entrenadores: trainers,
      reembolsos: refunds,
      motivo:
        "Reserva inmediata = deuda ganada pendiente + reembolsos pendientes; no equivale a saldo libre de caja.",
      cobertura_futuro:
        "Las comisiones futuras están cubiertas; el fijo futuro aparece al materializarse.",
    };
  }

  private obligationTotals(
    map: Map<string, CurrencyObligationTotals>,
    currencyId: string,
  ) {
    const found = map.get(currencyId);
    if (found) return found;
    const created: CurrencyObligationTotals = {
      earnedPending: 0n,
      futurePending: 0n,
      payableNow: 0n,
      refundPending: 0n,
      overdueConcepts: 0,
      requiresReview: 0,
      trainers: new Map(),
      refunds: [],
    };
    map.set(currencyId, created);
    return created;
  }

  private trainerTotals(
    currency: CurrencyObligationTotals,
    trainerId: string,
    trainerName: string,
  ) {
    const found = currency.trainers.get(trainerId);
    if (found) return found;
    const created: TrainerObligationTotals = {
      trainerId,
      trainerName,
      earnedPending: 0n,
      futurePending: 0n,
      payableNow: 0n,
      concepts: 0,
      overdueConcepts: 0,
      commissionConcepts: 0,
      fixedConcepts: 0,
      nextScheduledDate: null,
      requiresReview: 0,
    };
    currency.trainers.set(trainerId, created);
    return created;
  }

  private totals(map: Map<string, Totals>, key: string) {
    const found = map.get(key);
    if (found) return found;
    const created: Totals = {
      entries: 0n,
      exits: 0n,
      bookNet: 0n,
      operational: 0n,
      nonOperational: 0n,
      byOthers: 0n,
      pendingClassificationEffect: 0n,
      movements: 0,
      withoutAccount: 0,
      sourceReview: 0,
      pendingClassification: 0,
      categories: new Map(),
    };
    map.set(key, created);
    return created;
  }

  private nestedTotals(map: Map<string, Map<string, Totals>>, key: string) {
    const found = map.get(key);
    if (found) return found;
    const created = new Map<string, Totals>();
    map.set(key, created);
    return created;
  }

  private policy<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (
        error instanceof TreasuryLedgerPolicyError ||
        error instanceof OperationalResultsPolicyError ||
        error instanceof OperationalObligationsPolicyError ||
        error instanceof OperationalResultsAnnualPolicyError
      ) {
        throw new OperationalResultsServiceError(error.message);
      }
      throw error;
    }
  }
}

export function asOperationalResultsServiceError(error: unknown) {
  return error instanceof OperationalResultsServiceError ? error : null;
}
