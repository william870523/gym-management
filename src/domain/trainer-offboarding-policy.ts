export type TrainerOffboardingDecisionType =
  | "PENDIENTE"
  | "REASIGNAR"
  | "SIN_ENTRENADOR"
  | "AJUSTAR_CANCELAR";

export class TrainerOffboardingPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainerOffboardingPolicyError";
  }
}

const DECISIONS = new Set<TrainerOffboardingDecisionType>([
  "REASIGNAR",
  "SIN_ENTRENADOR",
  "AJUSTAR_CANCELAR",
]);

export function normalizeOffboardingEffectiveDate(
  value: unknown,
  businessToday: Date,
) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new TrainerOffboardingPolicyError(
      "La fecha efectiva debe usar el formato AAAA-MM-DD.",
    );
  }
  const [year, month, day] = raw.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new TrainerOffboardingPolicyError("La fecha efectiva no es válida.");
  }
  if (result.getTime() < businessToday.getTime()) {
    throw new TrainerOffboardingPolicyError(
      "La baja no puede prepararse con una fecha anterior al día comercial.",
    );
  }
  return result;
}

export function normalizeOffboardingReason(value: unknown) {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 5) {
    throw new TrainerOffboardingPolicyError(
      "Explique brevemente el motivo de la baja.",
    );
  }
  if (reason.length > 500) {
    throw new TrainerOffboardingPolicyError(
      "El motivo no puede superar 500 caracteres.",
    );
  }
  return reason;
}

export function normalizeOffboardingDecision(
  input: Record<string, unknown>,
  currentTrainerId: string,
) {
  const type = String(input.tipo ?? "").trim().toUpperCase() as TrainerOffboardingDecisionType;
  if (!DECISIONS.has(type)) {
    throw new TrainerOffboardingPolicyError(
      "La decisión debe ser REASIGNAR, SIN_ENTRENADOR o AJUSTAR_CANCELAR.",
    );
  }
  const targetTrainerId = String(input.id_entrenador_destino ?? "").trim() || null;
  const reason = String(input.motivo ?? "").trim().replace(/\s+/g, " ") || null;
  if (type === "REASIGNAR") {
    if (!targetTrainerId) {
      throw new TrainerOffboardingPolicyError(
        "Seleccione el entrenador que recibirá la membresía.",
      );
    }
    if (targetTrainerId === currentTrainerId) {
      throw new TrainerOffboardingPolicyError(
        "El entrenador de destino debe ser diferente al que causa baja.",
      );
    }
  }
  if (type === "AJUSTAR_CANCELAR" && (!reason || reason.length < 5)) {
    throw new TrainerOffboardingPolicyError(
      "El ajuste o cancelación necesita una explicación de al menos 5 caracteres.",
    );
  }
  if (reason && reason.length > 500) {
    throw new TrainerOffboardingPolicyError(
      "La explicación no puede superar 500 caracteres.",
    );
  }
  return {
    type,
    targetTrainerId: type === "REASIGNAR" ? targetTrainerId : null,
    reason,
  };
}

export function deriveOffboardingDraftState(
  decisions: readonly TrainerOffboardingDecisionType[],
) {
  const pending = decisions.filter((decision) => decision === "PENDIENTE").length;
  return {
    pending,
    state: pending === 0 ? "LISTO_PARA_REVISION" : "BORRADOR",
  } as const;
}

export function assertOffboardingExecutionReady(input: {
  state: string;
  effectiveDate: Date;
  businessToday: Date;
  decisions: readonly TrainerOffboardingDecisionType[];
}) {
  if (input.state !== "LISTO_PARA_REVISION") {
    throw new TrainerOffboardingPolicyError(
      "El expediente debe estar listo para revisión antes de aplicar sus decisiones.",
    );
  }
  if (input.effectiveDate.getTime() !== input.businessToday.getTime()) {
    throw new TrainerOffboardingPolicyError(
      input.effectiveDate.getTime() > input.businessToday.getTime()
        ? "La fecha efectiva todavía no ha llegado en el día comercial del gimnasio."
        : "La fecha efectiva ya pasó. Reprograme el expediente para el día comercial actual antes de ejecutar.",
    );
  }
  if (input.decisions.some((decision) => decision === "PENDIENTE")) {
    throw new TrainerOffboardingPolicyError(
      "Todas las membresías deben tener una decisión antes de ejecutar.",
    );
  }
  if (input.decisions.some((decision) => decision === "AJUSTAR_CANCELAR")) {
    throw new TrainerOffboardingPolicyError(
      "Hay membresías que requieren cambio de plan o ajuste financiero. Resuélvalas antes de aplicar la baja.",
    );
  }
}

export function assignmentStateForMembership(membershipState: string) {
  if (membershipState === "PENDIENTE_PAGO") return "PENDIENTE" as const;
  if (membershipState === "ACTIVA" || membershipState === "PAUSADA") {
    return "ACTIVA" as const;
  }
  throw new TrainerOffboardingPolicyError(
    "La membresía ya no admite una reasignación automática.",
  );
}

export function isTransferableFutureInstallment(input: {
  periodStart: Date;
  effectiveDate: Date;
  state: string;
}) {
  return input.periodStart.getTime() >= input.effectiveDate.getTime()
    && input.state === "PENDIENTE";
}

export function splitCommissionInstallmentAtDate(input: {
  amountMinor: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveDate: Date;
}) {
  const totalDuration = input.periodEnd.getTime() - input.periodStart.getTime();
  const servedDuration = input.effectiveDate.getTime() - input.periodStart.getTime();
  if (
    !Number.isInteger(input.amountMinor) ||
    input.amountMinor < 0 ||
    totalDuration <= 0 ||
    servedDuration <= 0 ||
    servedDuration >= totalDuration
  ) {
    throw new TrainerOffboardingPolicyError(
      "La cuota no puede dividirse en la fecha efectiva indicada.",
    );
  }
  const earnedMinor = Math.floor(
    (input.amountMinor * servedDuration) / totalDuration,
  );
  return {
    earnedMinor,
    futureMinor: input.amountMinor - earnedMinor,
  };
}
