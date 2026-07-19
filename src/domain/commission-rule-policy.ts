export const COMMISSION_CALCULATION_TYPES = [
  "PERCENTAGE",
  "FIXED_AMOUNT",
] as const;

export type CommissionCalculationType =
  (typeof COMMISSION_CALCULATION_TYPES)[number];

export type CommissionRuleStatus =
  | "VIGENTE"
  | "PROGRAMADA"
  | "FINALIZADA"
  | "INACTIVA";

export interface CommissionRuleDraft {
  trainerId: string | null;
  planId: string;
  calculationType: CommissionCalculationType;
  calculationValue: number;
  startAt: Date;
  endAt: Date | null;
  active: boolean;
}

export interface CommissionRuleInterval {
  trainerId: string | null;
  planId: string;
  startAt: Date;
  endAt: Date | null;
  active?: boolean;
  deleted?: boolean;
}

export class CommissionRulePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommissionRulePolicyError";
  }
}

function requiredId(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new CommissionRulePolicyError(`${label} es requerido.`);
  return normalized;
}

function optionalId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function utcInstant(value: unknown, fallback: Date, label: string): Date {
  if (value === undefined || value === null || value === "") {
    return new Date(fallback);
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new CommissionRulePolicyError(`${label} no es una fecha UTC válida.`);
  }
  return parsed;
}

export function normalizeCommissionRuleDraft(
  input: Record<string, unknown>,
  defaultStartAt: Date,
): CommissionRuleDraft {
  const planId = requiredId(input.id_planes_pago, "El plan");
  const trainerId = optionalId(input.id_entrenador);
  const calculationType = String(input.tipo_calculo ?? "")
    .trim()
    .toUpperCase() as CommissionCalculationType;
  if (!COMMISSION_CALCULATION_TYPES.includes(calculationType)) {
    throw new CommissionRulePolicyError(
      "El tipo de cálculo debe ser porcentaje o monto fijo.",
    );
  }

  const calculationValue = Number(input.valor_calculo);
  if (!Number.isFinite(calculationValue) || calculationValue <= 0) {
    throw new CommissionRulePolicyError(
      "El valor de la comisión debe ser mayor que cero.",
    );
  }
  if (calculationType === "PERCENTAGE" && calculationValue > 100) {
    throw new CommissionRulePolicyError(
      "El porcentaje de comisión no puede superar 100%.",
    );
  }

  const startAt = utcInstant(
    input.fecha_inicio,
    defaultStartAt,
    "La fecha de inicio",
  );
  const endAt = input.fecha_fin === undefined
    || input.fecha_fin === null
    || input.fecha_fin === ""
    ? null
    : utcInstant(input.fecha_fin, defaultStartAt, "La fecha de fin");
  if (endAt && endAt.getTime() <= startAt.getTime()) {
    throw new CommissionRulePolicyError(
      "La fecha de fin debe ser posterior a la fecha de inicio.",
    );
  }

  return {
    trainerId,
    planId,
    calculationType,
    calculationValue,
    startAt,
    endAt,
    active: input.activo !== false,
  };
}

export function sameCommissionRuleScope(
  left: CommissionRuleInterval,
  right: CommissionRuleInterval,
): boolean {
  return left.planId === right.planId && left.trainerId === right.trainerId;
}

export function commissionRuleIntervalsOverlap(
  left: CommissionRuleInterval,
  right: CommissionRuleInterval,
): boolean {
  if (!sameCommissionRuleScope(left, right)) return false;
  if (left.active === false || right.active === false) return false;
  if (left.deleted === true || right.deleted === true) return false;
  const leftEnd = left.endAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.endAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return left.startAt.getTime() < rightEnd
    && right.startAt.getTime() < leftEnd;
}

export function commissionRuleStatusAt(
  rule: CommissionRuleInterval,
  nowUtc: Date,
): CommissionRuleStatus {
  if (rule.deleted === true || rule.active === false) return "INACTIVA";
  if (rule.startAt.getTime() > nowUtc.getTime()) return "PROGRAMADA";
  if (rule.endAt && rule.endAt.getTime() <= nowUtc.getTime()) {
    return "FINALIZADA";
  }
  return "VIGENTE";
}

export function isCommissionRuleEffectiveAt(
  rule: CommissionRuleInterval,
  instantUtc: Date,
): boolean {
  return commissionRuleStatusAt(rule, instantUtc) === "VIGENTE";
}
