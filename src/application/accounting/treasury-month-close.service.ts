import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  assertCompletedMonth,
  assertMonthlyCloseReady,
  canCloseTreasuryMonth,
  canReopenTreasuryMonth,
  monthClosePeriod,
  monthlyCloseBlockers,
  normalizeMonthlyCloseOperationId,
  normalizeMonthlyCloseReason,
  normalizeMonthlyCloseRole,
  TreasuryMonthClosePolicyError,
  type MonthlyCloseCurrencyReadiness,
} from "../../domain/treasury-month-close-policy";
import {
  operationalResultsCloseBlockers,
  OperationalResultsCertificationPolicyError,
  prepareOperationalResultsForCertification,
} from "../../domain/operational-results-certification-policy";
import {
  managementMarginCloseBlockers,
  ManagementMarginCertificationPolicyError,
  prepareManagementMarginForCertification,
} from "../../domain/management-margin-certification-policy";
import type { OperationalResultsSnapshotProvider } from
  "../reporting/operational-results.reader";
import type { ManagementMarginSnapshotProvider } from
  "../reporting/management-margin.reader";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { CompensationProfileService } from "./compensation-profile.service";
import { TreasuryLedgerService } from "./treasury-ledger.service";
import { TreasuryMonthLockedError } from "./treasury-month-lock.service";

type Tx = Prisma.TransactionClient;

export class TreasuryMonthCloseServiceError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = "TreasuryMonthCloseServiceError";
  }
}

export class TreasuryMonthCloseService {
  private readonly profiles = new CompensationProfileService();
  private readonly ledger = new TreasuryLedgerService();

  constructor(
    private readonly operationalResults: OperationalResultsSnapshotProvider,
    private readonly managementMargin: ManagementMarginSnapshotProvider,
  ) {}

  async summary(gymId: string, monthValue: unknown, userId: string, role: unknown) {
    const live = await this.ledger.monthly(gymId, monthValue);
    return this.decorate(gymId, live, userId, role);
  }

  async close(input: {
    gymId: string;
    month: unknown;
    operationId: unknown;
    reason: unknown;
    userId: string;
    role: unknown;
  }) {
    if (!canCloseTreasuryMonth(input.role)) {
      throw new TreasuryMonthCloseServiceError(
        "Su rol no puede firmar cierres mensuales de Tesorería.",
        403,
      );
    }
    const operationId = this.policy(() =>
      normalizeMonthlyCloseOperationId(input.operationId)
    );
    const reason = this.policy(() =>
      normalizeMonthlyCloseReason(input.reason, "cerrar")
    );
    const period = this.policy(() => monthClosePeriod(input.month));
    const repeated = await prisma.tesoreriaCierreMensual.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeated) {
      if (
        repeated.gym_id !== input.gymId ||
        repeated.mes !== period.month ||
        repeated.motivo_cierre !== reason
      ) {
        throw new TreasuryMonthCloseServiceError(
          "Ese identificador de operación ya fue usado en otro cierre mensual.",
          409,
        );
      }
      return this.summary(input.gymId, period.month, input.userId, input.role);
    }

    const now = trustedClock.nowUtc();
    const currentBusinessDate = await prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, input.gymId, now)
    );
    this.policy(() => assertCompletedMonth(period.month, currentBusinessDate));
    const revisionBefore = await this.periodRevision(
      prisma,
      input.gymId,
      period.start,
      period.endExclusive,
    );
    const [live, operationalLive, managementLive] = await Promise.all([
      this.ledger.monthly(input.gymId, period.month),
      this.operationalResults.get({ gymId: input.gymId, month: period.month }),
      this.managementMargin.get({ gymId: input.gymId, month: period.month }),
    ]);
    const operationalSnapshot = this.policy(() =>
      prepareOperationalResultsForCertification(operationalLive, period.month)
    );
    const managementSnapshot = this.policy(() =>
      prepareManagementMarginForCertification(managementLive, period.month)
    );
    const revision = await this.periodRevision(
      prisma,
      input.gymId,
      period.start,
      period.endExclusive,
    );
    if (revisionBefore !== revision) {
      throw new TreasuryMonthCloseServiceError(
        "Los datos del mes cambiaron durante la revisión. Actualice el informe antes de firmar.",
        409,
      );
    }
    const blockers = monthlyCloseBlockers(
      (live.monedas ?? []) as MonthlyCloseCurrencyReadiness[],
    );
    this.policy(() => assertMonthlyCloseReady(blockers));

    const gym = await prisma.gym.findUnique({
      where: { gym_id: input.gymId },
      select: { timezone: true },
    });
    const actor = await this.identity(
      prisma as unknown as Tx,
      input.gymId,
      input.userId,
    );
    const snapshot = {
      version: 3,
      gym_id: input.gymId,
      timezone: gym?.timezone?.trim() || "Etc/UTC",
      mes: period.month,
      generado_at_utc: now.toISOString(),
      firmado_por: {
        user_id: input.userId,
        nombre: actor.user_nombre,
        rol: normalizeMonthlyCloseRole(input.role),
      },
      motivo: reason,
      resumen: live,
      resultado_operativo: operationalSnapshot,
      resultado_devengado: managementSnapshot,
    };
    const snapshotJson = JSON.stringify(snapshot);
    const hash = this.hash(snapshotJson);
    const closeId = randomUUID();

    await prisma.$transaction(async (tx) => {
      const sealedRevision = await this.periodRevision(
        tx,
        input.gymId,
        period.start,
        period.endExclusive,
      );
      if (sealedRevision !== revision) {
        throw new TreasuryMonthCloseServiceError(
          "El mes recibió cambios antes de la firma. Actualice y vuelva a revisar.",
          409,
        );
      }
      const active = await this.active(tx, input.gymId, period.month);
      if (active) {
        throw new TreasuryMonthCloseServiceError(
          `El período ${period.month} ya está cerrado.`,
          409,
        );
      }
      await this.identity(tx, input.gymId, input.userId);
      const created = await tx.tesoreriaCierreMensual.create({
        data: {
          cierre_mensual_id: closeId,
          operacion_id: operationId,
          reapertura_operacion_id: null,
          bloqueo_clave: this.lockKey(input.gymId, period.month),
          mes: period.month,
          fecha_desde: period.start,
          fecha_hasta_exclusiva: period.endExclusive,
          estado: "CERRADO",
          motivo_cierre: reason,
          resumen_snapshot_json: snapshotJson,
          resumen_sha256: hash,
          cerrado_por_user_id: input.userId,
          cerrado_por_nombre_snapshot: actor.user_nombre,
          cerrado_por_rol_snapshot: normalizeMonthlyCloseRole(input.role),
          cerrado_at: now,
          reapertura_motivo: null,
          reabierto_por_user_id: null,
          reabierto_por_nombre_snapshot: null,
          reabierto_por_rol_snapshot: null,
          reabierto_at: null,
          is_deleted: false,
          created_at: now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.recordSync(tx, "INSERT", input.gymId, created, operationId);
    }, { timeout: 30_000, isolationLevel: "Serializable" });
    return this.decorate(input.gymId, live, input.userId, input.role);
  }

  async reopen(input: {
    gymId: string;
    month: unknown;
    operationId: unknown;
    reason: unknown;
    userId: string;
    role: unknown;
  }) {
    if (!canReopenTreasuryMonth(input.role)) {
      throw new TreasuryMonthCloseServiceError(
        "Solo una cuenta administradora puede reabrir un mes cerrado.",
        403,
      );
    }
    const operationId = this.policy(() =>
      normalizeMonthlyCloseOperationId(input.operationId)
    );
    const reason = this.policy(() =>
      normalizeMonthlyCloseReason(input.reason, "reabrir")
    );
    const period = this.policy(() => monthClosePeriod(input.month));
    const repeated = await prisma.tesoreriaCierreMensual.findUnique({
      where: { reapertura_operacion_id: operationId },
    });
    if (repeated) {
      if (
        repeated.gym_id !== input.gymId ||
        repeated.mes !== period.month ||
        repeated.reapertura_motivo !== reason
      ) {
        throw new TreasuryMonthCloseServiceError(
          "Ese identificador de operación ya fue usado en otra reapertura.",
          409,
        );
      }
      return this.summary(input.gymId, period.month, input.userId, input.role);
    }

    const now = trustedClock.nowUtc();
    await prisma.$transaction(async (tx) => {
      const active = await this.active(tx, input.gymId, period.month);
      if (!active) {
        throw new TreasuryMonthCloseServiceError(
          `El período ${period.month} no tiene un cierre activo para reabrir.`,
          409,
        );
      }
      const actor = await this.identity(tx, input.gymId, input.userId);
      const updated = await tx.tesoreriaCierreMensual.update({
        where: { cierre_mensual_id: active.cierre_mensual_id },
        data: {
          estado: "REABIERTO",
          bloqueo_clave: null,
          reapertura_operacion_id: operationId,
          reapertura_motivo: reason,
          reabierto_por_user_id: input.userId,
          reabierto_por_nombre_snapshot: actor.user_nombre,
          reabierto_por_rol_snapshot: normalizeMonthlyCloseRole(input.role),
          reabierto_at: now,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.recordSync(tx, "UPDATE", input.gymId, updated, operationId);
    }, { timeout: 30_000, isolationLevel: "Serializable" });
    const live = await this.ledger.monthly(input.gymId, period.month);
    return this.decorate(input.gymId, live, input.userId, input.role);
  }

  private async decorate(
    gymId: string,
    live: Record<string, any>,
    userId: string,
    role: unknown,
  ) {
    const period = this.policy(() => monthClosePeriod(live.mes));
    const [
      history,
      currentBusinessDate,
      operationalResult,
      managementResult,
    ] = await Promise.all([
      prisma.tesoreriaCierreMensual.findMany({
        where: { gym_id: gymId, mes: period.month, is_deleted: false },
        orderBy: [{ cerrado_at: "desc" }, { cierre_mensual_id: "desc" }],
        take: 20,
      }),
      prisma.$transaction((tx) =>
        this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())
      ),
      this.operationalResults.get({ gymId, month: period.month }),
      this.managementMargin.get({ gymId, month: period.month }),
    ]);
    const active = history.find(
      (row) => row.estado === "CERRADO" && row.bloqueo_clave,
    ) ?? null;
    const blockers = [
      ...monthlyCloseBlockers(
        (live.monedas ?? []) as MonthlyCloseCurrencyReadiness[],
      ),
      ...operationalResultsCloseBlockers(operationalResult, period.month),
      ...managementMarginCloseBlockers(managementResult, period.month),
    ];
    const monthEnded = period.endExclusive.getTime() <= currentBusinessDate.getTime();
    let report = live;
    let integrityVerified: boolean | null = null;
    if (active) {
      integrityVerified = this.hash(active.resumen_snapshot_json) === active.resumen_sha256;
      const frozen = this.parseSnapshot(active.resumen_snapshot_json);
      if (frozen?.resumen && typeof frozen.resumen === "object") {
        report = frozen.resumen;
      }
    }
    return {
      ...report,
      cierre_mensual: {
        estado: active ? "CERRADO" : "ABIERTO",
        mes_terminado: monthEnded,
        listo_para_cerrar: !active && monthEnded && blockers.length === 0,
        bloqueadores: blockers,
        capacidades: {
          puede_cerrar: !active && monthEnded && blockers.length === 0 &&
            canCloseTreasuryMonth(role),
          puede_reabrir: Boolean(active) && canReopenTreasuryMonth(role),
          user_id: userId,
          rol: normalizeMonthlyCloseRole(role),
        },
        ciclo_actual: active ? this.present(active, integrityVerified) : null,
        ultimo_ciclo: history[0] ? this.present(
          history[0],
          this.hash(history[0].resumen_snapshot_json) === history[0].resumen_sha256,
        ) : null,
        historial: history.map((row) => this.present(
          row,
          this.hash(row.resumen_snapshot_json) === row.resumen_sha256,
        )),
      },
    };
  }

  private present(row: any, integrityVerified: boolean | null) {
    return {
      cierre_mensual_id: row.cierre_mensual_id,
      mes: row.mes,
      estado: row.estado,
      motivo_cierre: row.motivo_cierre,
      resumen_sha256: row.resumen_sha256,
      integridad_verificada: integrityVerified,
      cerrado_por_user_id: row.cerrado_por_user_id,
      cerrado_por_nombre: row.cerrado_por_nombre_snapshot,
      cerrado_por_rol: row.cerrado_por_rol_snapshot,
      cerrado_at: row.cerrado_at,
      reapertura_motivo: row.reapertura_motivo,
      reabierto_por_user_id: row.reabierto_por_user_id,
      reabierto_por_nombre: row.reabierto_por_nombre_snapshot,
      reabierto_por_rol: row.reabierto_por_rol_snapshot,
      reabierto_at: row.reabierto_at,
    };
  }

  private async active(tx: Tx, gymId: string, month: string) {
    return tx.tesoreriaCierreMensual.findFirst({
      where: {
        gym_id: gymId,
        mes: month,
        estado: "CERRADO",
        bloqueo_clave: { not: null },
        is_deleted: false,
      },
      orderBy: [{ cerrado_at: "desc" }, { cierre_mensual_id: "desc" }],
    });
  }

  private async periodRevision(
    db: any,
    gymId: string,
    start: Date,
    endExclusive: Date,
  ) {
    const specs = [
      db.tesoreriaMovimiento.aggregate({
        where: { gym_id: gymId, fecha_negocio: { gte: start, lt: endExclusive } },
        _count: true,
        _max: { updated_at: true },
      }),
      db.tesoreriaCierre.aggregate({
        where: { gym_id: gymId, fecha_negocio: { lt: endExclusive } },
        _count: true,
        _max: { updated_at: true },
      }),
      db.tesoreriaCierreSolicitud.aggregate({
        where: { gym_id: gymId, fecha_negocio: { gte: start, lt: endExclusive } },
        _count: true,
        _max: { updated_at: true },
      }),
      db.tesoreriaConciliacion.aggregate({
        where: { gym_id: gymId, fecha_negocio: { lt: endExclusive } },
        _count: true,
        _max: { updated_at: true },
      }),
      db.cuenta.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.moneda.aggregate({
        _count: true,
        _max: { updated_at: true },
      }),
      db.entrenadorComisionCuota.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.entrenadorComisionDevengo.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.entrenadorObligacionFija.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.entrenadorLiquidacionAplicacion.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.entrenadorLiquidacionObligacionAplicacion.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.membresiaAjusteFinanciero.aggregate({
        where: { gym_id: gymId, tipo: "REEMBOLSO_PENDIENTE" },
        _count: true,
        _max: { updated_at: true },
      }),
      db.pagoCliente.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.pagoMembresiaAplicacion.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.creditoMembresiaAplicacion.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.membresiaPausa.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.membresiaAjusteFinanciero.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.planesPago.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.clienteReembolsoTesoreria.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.clienteReembolsoReversion.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.membresiaCliente.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.entrenador.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
      db.cliente.aggregate({
        where: { gym_id: gymId },
        _count: true,
        _max: { updated_at: true },
      }),
    ];
    const rows = await Promise.all(specs);
    return JSON.stringify(rows.map((row: any) => ({
      count: row._count,
      updatedAt: row._max.updated_at?.toISOString() ?? null,
    })));
  }

  private async identity(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: {
        user_id: userId,
        gym_id: gymId,
        active: true,
        is_deleted: false,
      },
      select: { user_nombre: true },
    });
    if (!user) {
      throw new TreasuryMonthCloseServiceError(
        "La cuenta operadora no es válida.",
        403,
      );
    }
    return user;
  }

  private async recordSync(
    tx: Tx,
    operation: "INSERT" | "UPDATE",
    gymId: string,
    row: any,
    eventId: string,
  ) {
    await tx.syncLog.create({
      data: {
        event_id: eventId,
        entidad: "tesoreria_cierre_mensual",
        operacion: operation,
        entidad_id: row.cierre_mensual_id,
        gym_id: gymId,
        device_id: null,
        payload_json: JSON.stringify(serialize(row)),
      },
    });
  }

  private lockKey(gymId: string, month: string) {
    return `${gymId}|${month}`;
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private parseSnapshot(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private policy<T>(callback: () => T): T {
    try {
      return callback();
    } catch (error) {
      if (
        error instanceof TreasuryMonthClosePolicyError ||
        error instanceof OperationalResultsCertificationPolicyError ||
        error instanceof ManagementMarginCertificationPolicyError
      ) {
        throw new TreasuryMonthCloseServiceError(error.message, 409);
      }
      throw error;
    }
  }
}

export function asTreasuryMonthCloseError(error: unknown) {
  if (error instanceof TreasuryMonthCloseServiceError) return error;
  if (error instanceof TreasuryMonthLockedError) {
    return new TreasuryMonthCloseServiceError(error.message, 409);
  }
  if (error instanceof TreasuryMonthClosePolicyError) {
    return new TreasuryMonthCloseServiceError(error.message, 409);
  }
  if (error instanceof OperationalResultsCertificationPolicyError) {
    return new TreasuryMonthCloseServiceError(error.message, 409);
  }
  if (error instanceof ManagementMarginCertificationPolicyError) {
    return new TreasuryMonthCloseServiceError(error.message, 409);
  }
  return null;
}
