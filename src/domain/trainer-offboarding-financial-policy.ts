export type OffboardingFinancialResolutionType =
  | "CAMBIO_PLAN"
  | "CREDITO_CLIENTE"
  | "REEMBOLSO_PENDIENTE";

export class OffboardingFinancialPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffboardingFinancialPolicyError";
  }
}

const DAY_MS = 86_400_000;

export function calculateUnusedMembershipValue(input: {
  paidMinor: number;
  durationDays: number;
  start: Date;
  endExclusive: Date;
  effectiveDate: Date;
  membershipState: string;
  pausedRemainingDays?: number | null;
}) {
  if (!Number.isInteger(input.paidMinor) || input.paidMinor < 0) {
    throw new OffboardingFinancialPolicyError("El importe pagado no es válido.");
  }
  if (!Number.isInteger(input.durationDays) || input.durationDays <= 0) {
    throw new OffboardingFinancialPolicyError("La duración contractual no es válida.");
  }
  const remainingDays = input.membershipState === "PENDIENTE_PAGO"
    ? input.durationDays
    : input.membershipState === "PAUSADA" && input.pausedRemainingDays != null
      ? Math.min(input.durationDays, Math.max(0, input.pausedRemainingDays))
      : Math.min(input.durationDays, Math.max(0, Math.ceil(
          (input.endExclusive.getTime() - input.effectiveDate.getTime()) / DAY_MS,
        )));
  const unusedMinor = Math.round(
    (input.paidMinor * remainingDays) / input.durationDays,
  );
  return {
    durationDays: input.durationDays,
    remainingDays,
    consumedDays: input.durationDays - remainingDays,
    paidMinor: input.paidMinor,
    unusedMinor,
    consumedMinor: input.paidMinor - unusedMinor,
    method: input.membershipState === "PAUSADA" && input.pausedRemainingDays != null
      ? "DIAS_SERVICIO_PAUSA"
      : "DIAS_SERVICIO",
  } as const;
}

export function calculateOffboardingFinancialDestination(input: {
  type: OffboardingFinancialResolutionType;
  unusedMinor: number;
  destinationPriceMinor?: number | null;
}) {
  if (!Number.isInteger(input.unusedMinor) || input.unusedMinor < 0) {
    throw new OffboardingFinancialPolicyError("El crédito calculado no es válido.");
  }
  if (input.type === "CAMBIO_PLAN") {
    const price = input.destinationPriceMinor;
    if (!Number.isInteger(price) || (price ?? 0) <= 0) {
      throw new OffboardingFinancialPolicyError(
        "Seleccione un plan de destino con precio válido.",
      );
    }
    const creditAppliedMinor = Math.min(input.unusedMinor, price!);
    return {
      creditAppliedMinor,
      amountDueMinor: price! - creditAppliedMinor,
      remainingCreditMinor: input.unusedMinor - creditAppliedMinor,
      refundMinor: 0,
      state: "APLICADA" as const,
    };
  }
  if (input.type === "CREDITO_CLIENTE") {
    return {
      creditAppliedMinor: 0,
      amountDueMinor: 0,
      remainingCreditMinor: input.unusedMinor,
      refundMinor: 0,
      state: "APLICADA" as const,
    };
  }
  if (input.type === "REEMBOLSO_PENDIENTE") {
    return {
      creditAppliedMinor: 0,
      amountDueMinor: 0,
      remainingCreditMinor: 0,
      refundMinor: input.unusedMinor,
      state: "PENDIENTE_TESORERIA" as const,
    };
  }
  throw new OffboardingFinancialPolicyError("La resolución financiera no es válida.");
}

export function normalizeFinancialResolutionReason(value: unknown) {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 5) {
    throw new OffboardingFinancialPolicyError(
      "Explique la razón financiera en al menos 5 caracteres.",
    );
  }
  if (reason.length > 500) {
    throw new OffboardingFinancialPolicyError(
      "La razón financiera no puede superar 500 caracteres.",
    );
  }
  return reason;
}
