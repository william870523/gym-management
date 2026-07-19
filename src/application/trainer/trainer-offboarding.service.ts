import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";
import { CompensationProfileService } from "../accounting/compensation-profile.service";
import { FixedObligationService } from "../accounting/fixed-obligation.service";

type MoneyBucket = {
  moneda_id: string;
  moneda_codigo: string;
  comision_ganada: bigint;
  comision_pagada: bigint;
  comision_pendiente: bigint;
  comision_futura: bigint;
  fijo_ganado: bigint;
  fijo_pagado: bigint;
  fijo_pendiente: bigint;
};

export class TrainerOffboardingError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = "TrainerOffboardingError";
  }
}

export class TrainerOffboardingService {
  private readonly profiles = new CompensationProfileService();
  private readonly fixedObligations = new FixedObligationService();

  async impact(gymId: string, trainerId: string) {
    const normalizedId = trainerId.trim();
    if (!normalizedId) throw new TrainerOffboardingError("El entrenador es requerido.");
    await this.fixedObligations.materializeDue(gymId);
    const now = trustedClock.nowUtc();
    const businessToday = await this.profiles.businessDateForInstant(
      prisma as any,
      gymId,
      now,
    );
    const trainer = await prisma.entrenador.findFirst({
      where: { id_entrenador: normalizedId, gym_id: gymId, is_deleted: false },
    });
    if (!trainer) throw new TrainerOffboardingError("Entrenador no encontrado.", 404);

    const assignments = await prisma.membresiaEntrenadorAsignacion.findMany({
      where: {
        gym_id: gymId,
        id_entrenador: normalizedId,
        is_deleted: false,
        estado: { in: ["PENDIENTE", "ACTIVA"] },
        fecha_inicio: { lte: businessToday },
        OR: [{ fecha_fin: null }, { fecha_fin: { gt: businessToday } }],
      },
      orderBy: [{ fecha_inicio: "asc" }, { asignacion_id: "asc" }],
    });
    const assignmentIds = assignments.map((row) => row.membresia_id);
    const memberships = await prisma.membresiaCliente.findMany({
      where: {
        gym_id: gymId,
        is_deleted: false,
        estado: { in: ["PENDIENTE_PAGO", "ACTIVA", "PAUSADA"] },
        OR: [
          ...(assignmentIds.length ? [{ membresia_id: { in: assignmentIds } }] : []),
          { id_entrenador: normalizedId },
        ],
      },
      orderBy: [{ fecha_fin: "asc" }, { membresia_id: "asc" }],
    });
    const clientIds = [...new Set(memberships.map((row) => row.ci))];
    const [clients, installments, fixedRows, activeProfiles] = await Promise.all([
      clientIds.length
        ? prisma.cliente.findMany({ where: { ci: { in: clientIds }, gym_id: gymId } })
        : [],
      prisma.entrenadorComisionCuota.findMany({
        where: {
          gym_id: gymId,
          id_entrenador: normalizedId,
          is_deleted: false,
          estado: { not: "ANULADO" },
        },
      }),
      prisma.entrenadorObligacionFija.findMany({
        where: {
          gym_id: gymId,
          id_entrenador: normalizedId,
          is_deleted: false,
          estado: { not: "ANULADO" },
        },
      }),
      prisma.entrenadorCompensacionPerfil.count({
        where: {
          gym_id: gymId,
          id_entrenador: normalizedId,
          activo: true,
          is_deleted: false,
          fecha_inicio: { lte: businessToday },
          OR: [{ fecha_fin: null }, { fecha_fin: { gt: businessToday } }],
        },
      }),
    ]);
    const installmentIds = installments.map((row) => row.cuota_id);
    const applications = installmentIds.length
      ? await prisma.entrenadorLiquidacionAplicacion.findMany({
          where: {
            gym_id: gymId,
            cuota_id: { in: installmentIds },
            estado: "APLICADA",
            is_deleted: false,
          },
        })
      : [];
    const paidByInstallment = new Map<string, bigint>();
    for (const row of applications) {
      paidByInstallment.set(
        row.cuota_id,
        (paidByInstallment.get(row.cuota_id) ?? 0n) + this.minor(row.monto_aplicado),
      );
    }
    const currencyIds = [...new Set([
      ...installments.map((row) => row.moneda_id),
      ...fixedRows.map((row) => row.moneda_id),
    ])];
    const currencies = currencyIds.length
      ? await prisma.moneda.findMany({ where: { moneda_id: { in: currencyIds }, is_deleted: false } })
      : [];
    const currencyMap = new Map(currencies.map((row) => [row.moneda_id, row.codigo]));
    const buckets = new Map<string, MoneyBucket>();
    const bucketFor = (currencyId: string) => {
      let bucket = buckets.get(currencyId);
      if (!bucket) {
        bucket = {
          moneda_id: currencyId,
          moneda_codigo: currencyMap.get(currencyId) ?? currencyId,
          comision_ganada: 0n,
          comision_pagada: 0n,
          comision_pendiente: 0n,
          comision_futura: 0n,
          fijo_ganado: 0n,
          fijo_pagado: 0n,
          fijo_pendiente: 0n,
        };
        buckets.set(currencyId, bucket);
      }
      return bucket;
    };
    for (const installment of installments) {
      const amount = this.minor(installment.monto);
      const paid = paidByInstallment.get(installment.cuota_id) ?? 0n;
      const remaining = amount > paid ? amount - paid : 0n;
      const bucket = bucketFor(installment.moneda_id);
      bucket.comision_pagada += paid;
      if (installment.periodo_fin.getTime() <= businessToday.getTime()) {
        bucket.comision_ganada += amount;
        bucket.comision_pendiente += remaining;
      } else {
        bucket.comision_futura += remaining;
      }
    }
    for (const obligation of fixedRows) {
      const amount = this.minor(obligation.monto);
      const bucket = bucketFor(obligation.moneda_id);
      bucket.fijo_ganado += amount;
      if (obligation.estado === "PAGADO") bucket.fijo_pagado += amount;
      else bucket.fijo_pendiente += amount;
    }
    const clientMap = new Map(clients.map((row) => [row.ci, row]));
    const assignmentMap = new Map(assignments.map((row) => [row.membresia_id, row]));
    const membershipImpact = memberships.map((membership) => {
      const client = clientMap.get(membership.ci);
      const assignment = assignmentMap.get(membership.membresia_id);
      return {
        membresia_id: membership.membresia_id,
        asignacion_id: assignment?.asignacion_id ?? null,
        ci: membership.ci,
        socio_nombre: client ? `${client.nombres} ${client.apellidos}`.trim() : membership.ci,
        plan_nombre: membership.plan_nombre_snapshot,
        estado: membership.estado,
        fecha_inicio: membership.fecha_inicio,
        fecha_fin: membership.fecha_fin,
        origen_asignacion: assignment ? "HISTORIAL" : "PROYECCION_CLIENTE",
        opciones: ["REASIGNAR", "SIN_ENTRENADOR", "AJUSTAR_CANCELAR"],
        recomendacion: "REASIGNAR",
      };
    });
    const financial = [...buckets.values()].map((row) => ({
      moneda_id: row.moneda_id,
      moneda_codigo: row.moneda_codigo,
      comision_ganada: this.money(row.comision_ganada),
      comision_pagada: this.money(row.comision_pagada),
      comision_pendiente: this.money(row.comision_pendiente),
      comision_futura: this.money(row.comision_futura),
      fijo_ganado: this.money(row.fijo_ganado),
      fijo_pagado: this.money(row.fijo_pagado),
      fijo_pendiente: this.money(row.fijo_pendiente),
    }));
    const blockers: string[] = [];
    if (membershipImpact.length) blockers.push("MEMBRESIAS_SIN_RESOLVER");
    if (activeProfiles > 0) blockers.push("PERFIL_COMPENSACION_VIGENTE");
    if (financial.some((row) => Number(row.comision_pendiente) > 0 || Number(row.fijo_pendiente) > 0)) {
      blockers.push("SALDO_GANADO_PENDIENTE");
    }
    if (financial.some((row) => Number(row.comision_futura) > 0)) {
      blockers.push("COMISION_FUTURA_SIN_RESOLVER");
    }
    return {
      entrenador: {
        id_entrenador: trainer.id_entrenador,
        nombre: `${trainer.nombres_entrenador} ${trainer.apellidos_entrenador}`.trim(),
        ci: trainer.ci_entrenador,
      },
      business_date: businessToday.toISOString().slice(0, 10),
      membresias: membershipImpact,
      finanzas_por_moneda: financial,
      perfiles_vigentes: activeProfiles,
      bloqueos: blockers,
      puede_baja_directa: blockers.length === 0,
    };
  }

  async assertDirectDeletionAllowed(gymId: string, trainerId: string) {
    const impact = await this.impact(gymId, trainerId);
    if (!impact.puede_baja_directa) {
      throw new TrainerOffboardingError(
        "La baja directa está bloqueada. Revise membresías, perfiles y saldos en el asistente de baja.",
        409,
        impact,
      );
    }
    return impact;
  }

  private minor(value: { toFixed(value: number): string } | number) {
    const normalized = typeof value === "number" ? value.toFixed(2) : value.toFixed(2);
    const [whole, fraction = ""] = normalized.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }

  private money(value: bigint) {
    return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
  }
}

export function asTrainerOffboardingError(error: unknown) {
  return error instanceof TrainerOffboardingError ? error : null;
}
