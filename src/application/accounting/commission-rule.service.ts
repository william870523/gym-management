import type { Prisma } from "@prisma/client";
import { trustedClock } from "../../config/trusted-clock";
import {
  CommissionRulePolicyError,
  commissionRuleIntervalsOverlap,
  commissionRuleStatusAt,
  normalizeCommissionRuleDraft,
  type CommissionRuleDraft,
  type CommissionRuleInterval,
} from "../../domain/commission-rule-policy";
import { prisma } from "../../infrastructure/db/prismaClient";

const COMMISSION_ENTITY = "entrenador_comision_regla";

export class CommissionRuleServiceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "CommissionRuleServiceError";
  }
}

type Transaction = Prisma.TransactionClient;

export class CommissionRuleService {
  async list(gymId: string) {
    const now = trustedClock.nowUtc();
    const rules = await prisma.entrenadorComisionRegla.findMany({
      where: { gym_id: gymId, is_deleted: false },
      orderBy: [
        { fecha_inicio: "desc" },
        { updated_at: "desc" },
        { regla_id: "desc" },
      ],
    });
    const conflictIds = new Set<string>();
    for (let left = 0; left < rules.length; left += 1) {
      for (let right = left + 1; right < rules.length; right += 1) {
        if (commissionRuleIntervalsOverlap(
          this.toInterval(rules[left]),
          this.toInterval(rules[right]),
        )) {
          conflictIds.add(rules[left].regla_id);
          conflictIds.add(rules[right].regla_id);
        }
      }
    }

    const planIds = [...new Set(rules.map((rule) => rule.id_planes_pago))];
    const trainerIds = [
      ...new Set(
        rules
          .map((rule) => rule.id_entrenador)
          .filter((id): id is string => id !== null),
      ),
    ];
    const [plans, trainers] = await Promise.all([
      planIds.length
        ? prisma.planesPago.findMany({
            where: { id_planes_pago: { in: planIds }, gym_id: gymId },
          })
        : Promise.resolve([]),
      trainerIds.length
        ? prisma.entrenador.findMany({
            where: { id_entrenador: { in: trainerIds }, gym_id: gymId },
          })
        : Promise.resolve([]),
    ]);
    const planMap = new Map(
      plans.map((plan) => [
        plan.id_planes_pago,
        plan.nombre_plan_pago ?? plan.id_planes_pago,
      ]),
    );
    const trainerMap = new Map(
      trainers.map((trainer) => [
        trainer.id_entrenador,
        `${trainer.nombres_entrenador} ${trainer.apellidos_entrenador}`.trim(),
      ]),
    );
    return rules.map((rule) => ({
      ...rule,
      plan_nombre: planMap.get(rule.id_planes_pago) ?? rule.id_planes_pago,
      entrenador_nombre: rule.id_entrenador
        ? trainerMap.get(rule.id_entrenador) ?? rule.id_entrenador
        : "Regla general del plan",
      vigencia_estado: commissionRuleStatusAt(this.toInterval(rule), now),
      tiene_conflicto: conflictIds.has(rule.regla_id),
    }));
  }

  async create(gymId: string, input: Record<string, unknown>) {
    const now = trustedClock.nowUtc();
    const draft = normalizeCommissionRuleDraft(input, now);
    draft.active = true;
    return prisma.$transaction(async (tx) => {
      await this.assertReferences(tx, gymId, draft);
      await this.assertNoOverlap(tx, gymId, draft);
      const created = await tx.entrenadorComisionRegla.create({
        data: {
          regla_id: crypto.randomUUID(),
          id_entrenador: draft.trainerId,
          id_planes_pago: draft.planId,
          tipo_calculo: draft.calculationType,
          valor_calculo: draft.calculationValue,
          activo: true,
          fecha_inicio: draft.startAt,
          fecha_fin: draft.endAt,
          is_deleted: false,
          created_at: now,
          gym_id: gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.registerSync(tx, "INSERT", gymId, created);
      return created;
    });
  }

  async update(gymId: string, id: string, input: Record<string, unknown>) {
    const now = trustedClock.nowUtc();
    const existing = await prisma.entrenadorComisionRegla.findFirst({
      where: { regla_id: id, gym_id: gymId, is_deleted: false },
    });
    if (!existing) throw new CommissionRuleServiceError("La regla no existe.", 404);
    const status = commissionRuleStatusAt(this.toInterval(existing), now);
    if (status === "FINALIZADA") {
      throw new CommissionRuleServiceError(
        "Una regla finalizada forma parte del historial y no se puede editar.",
        409,
      );
    }
    const draft = normalizeCommissionRuleDraft(input, existing.fecha_inicio);
    draft.active = true;
    return prisma.$transaction(async (tx) => {
      await this.assertReferences(tx, gymId, draft);
      if (status === "VIGENTE" && existing.fecha_inicio.getTime() < now.getTime()) {
        const replacement = { ...draft, startAt: now, active: true };
        if (replacement.endAt && replacement.endAt.getTime() <= now.getTime()) {
          throw new CommissionRuleServiceError(
            "La fecha de fin de la nueva vigencia debe ser posterior al momento actual.",
          );
        }
        await this.assertNoOverlap(tx, gymId, replacement, [id]);
        const closed = await tx.entrenadorComisionRegla.update({
          where: { regla_id: id },
          data: {
            fecha_fin: now,
            updated_at: now,
            version: { increment: 1 },
          },
        });
        await this.registerSync(tx, "UPDATE", gymId, closed);
        const created = await tx.entrenadorComisionRegla.create({
          data: {
            regla_id: crypto.randomUUID(),
            id_entrenador: replacement.trainerId,
            id_planes_pago: replacement.planId,
            tipo_calculo: replacement.calculationType,
            valor_calculo: replacement.calculationValue,
            activo: true,
            fecha_inicio: replacement.startAt,
            fecha_fin: replacement.endAt,
            is_deleted: false,
            created_at: now,
            gym_id: gymId,
            source_device: "WEB_ADMIN",
            version: 1,
            updated_at: now,
            deleted_at: null,
          },
        });
        await this.registerSync(tx, "INSERT", gymId, created);
        return { ...created, reemplaza_regla_id: id };
      }
      await this.assertNoOverlap(tx, gymId, draft, [id]);
      const updated = await tx.entrenadorComisionRegla.update({
        where: { regla_id: id },
        data: {
          id_entrenador: draft.trainerId,
          id_planes_pago: draft.planId,
          tipo_calculo: draft.calculationType,
          valor_calculo: draft.calculationValue,
          activo: true,
          fecha_inicio: draft.startAt,
          fecha_fin: draft.endAt,
          updated_at: now,
          version: { increment: 1 },
        },
      });
      await this.registerSync(tx, "UPDATE", gymId, updated);
      return updated;
    });
  }

  async closeOrCancel(gymId: string, id: string) {
    const now = trustedClock.nowUtc();
    return prisma.$transaction(async (tx) => {
      const existing = await tx.entrenadorComisionRegla.findFirst({
        where: { regla_id: id, gym_id: gymId, is_deleted: false },
      });
      if (!existing) throw new CommissionRuleServiceError("La regla no existe.", 404);
      const status = commissionRuleStatusAt(this.toInterval(existing), now);
      if (status === "FINALIZADA") {
        throw new CommissionRuleServiceError(
          "La regla ya finalizó y debe conservarse como historial.",
          409,
        );
      }
      if (existing.fecha_inicio.getTime() >= now.getTime() || status === "INACTIVA") {
        const cancelled = await tx.entrenadorComisionRegla.update({
          where: { regla_id: id },
          data: {
            activo: false,
            is_deleted: true,
            deleted_at: now,
            updated_at: now,
            version: { increment: 1 },
          },
        });
        await this.registerSync(tx, "DELETE", gymId, cancelled);
        return { ...cancelled, accion: "CANCELADA" };
      }
      const closed = await tx.entrenadorComisionRegla.update({
        where: { regla_id: id },
        data: {
          fecha_fin: now,
          updated_at: now,
          version: { increment: 1 },
        },
      });
      await this.registerSync(tx, "UPDATE", gymId, closed);
      return { ...closed, accion: "FINALIZADA" };
    });
  }

  private async assertReferences(
    tx: Transaction,
    gymId: string,
    draft: CommissionRuleDraft,
  ) {
    const plan = await tx.planesPago.findFirst({
      where: {
        id_planes_pago: draft.planId,
        gym_id: gymId,
        activo: true,
        is_deleted: false,
      },
    });
    if (!plan) throw new CommissionRuleServiceError("El plan no existe o está inactivo.", 404);
    if (!plan.incluye_entrenador) {
      throw new CommissionRuleServiceError(
        "Solo los planes que incluyen entrenador pueden tener reglas de comisión.",
        409,
      );
    }
    if (!draft.trainerId) return;
    const trainer = await tx.entrenador.findFirst({
      where: {
        id_entrenador: draft.trainerId,
        gym_id: gymId,
        activo_entrenador: true,
        is_deleted: false,
      },
    });
    if (!trainer) {
      throw new CommissionRuleServiceError(
        "El entrenador de la excepción no existe o está inactivo.",
        404,
      );
    }
  }

  private async assertNoOverlap(
    tx: Transaction,
    gymId: string,
    draft: CommissionRuleDraft,
    excludedIds: string[] = [],
  ) {
    const existing = await tx.entrenadorComisionRegla.findMany({
      where: {
        gym_id: gymId,
        id_planes_pago: draft.planId,
        id_entrenador: draft.trainerId,
        activo: true,
        is_deleted: false,
        ...(excludedIds.length ? { regla_id: { notIn: excludedIds } } : {}),
      },
    });
    const candidate = this.draftToInterval(draft);
    if (existing.some((rule) => commissionRuleIntervalsOverlap(
      candidate,
      this.toInterval(rule),
    ))) {
      const scope = draft.trainerId
        ? "esa excepción de entrenador"
        : "la regla general de ese plan";
      throw new CommissionRuleServiceError(
        `La vigencia se solapa con ${scope}. Ajuste las fechas antes de guardar.`,
        409,
      );
    }
  }

  private toInterval(rule: {
    id_entrenador: string | null;
    id_planes_pago: string;
    fecha_inicio: Date;
    fecha_fin: Date | null;
    activo: boolean;
    is_deleted: boolean;
  }): CommissionRuleInterval {
    return {
      trainerId: rule.id_entrenador,
      planId: rule.id_planes_pago,
      startAt: rule.fecha_inicio,
      endAt: rule.fecha_fin,
      active: rule.activo,
      deleted: rule.is_deleted,
    };
  }

  private draftToInterval(draft: CommissionRuleDraft): CommissionRuleInterval {
    return {
      trainerId: draft.trainerId,
      planId: draft.planId,
      startAt: draft.startAt,
      endAt: draft.endAt,
      active: draft.active,
      deleted: false,
    };
  }

  private async registerSync(
    tx: Transaction,
    operation: "INSERT" | "UPDATE" | "DELETE",
    gymId: string,
    record: { regla_id: string },
  ) {
    await tx.syncLog.create({
      data: {
        event_id: crypto.randomUUID(),
        entidad: COMMISSION_ENTITY,
        operacion: operation,
        entidad_id: record.regla_id,
        gym_id: gymId,
        device_id: "WEB_ADMIN",
        payload_json: JSON.stringify(record),
      },
    });
  }
}

export function asCommissionRuleServiceError(error: unknown) {
  if (error instanceof CommissionRuleServiceError) return error;
  if (error instanceof CommissionRulePolicyError) {
    return new CommissionRuleServiceError(error.message, 400);
  }
  return null;
}
