export type CommissionState = "PENDIENTE" | "PAGADO" | "ANULADO" | string;

export interface ReversalMembershipResolution {
  paidAmount: number;
  state: string;
  activatedAt: Date | null;
}

const MONEY_EPSILON = 0.005;

export function normalizeReversalReason(value: unknown): string {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 5) {
    throw new Error("Explique el motivo de la anulación (mínimo 5 caracteres).");
  }
  if (reason.length > 500) {
    throw new Error("El motivo de la anulación no puede superar 500 caracteres.");
  }
  return reason;
}

export function hasPaidCommission(input: {
  accrualStates: CommissionState[];
  paidInstallmentCounts: number[];
  installmentStates: CommissionState[];
}): boolean {
  return input.accrualStates.includes("PAGADO")
    || input.paidInstallmentCounts.some((count) => count > 0)
    || input.installmentStates.includes("PAGADO");
}

export function resolveMembershipAfterReversal(input: {
  contractedAmount: number;
  remainingPaidAmount: number;
  currentState: string;
  currentActivatedAt: Date | null;
}): ReversalMembershipResolution {
  const paidAmount = Math.max(0, Math.round(input.remainingPaidAmount * 100) / 100);
  const remainsPaid = paidAmount + MONEY_EPSILON >= input.contractedAmount;
  return {
    paidAmount,
    state: remainsPaid ? input.currentState : "PENDIENTE_PAGO",
    activatedAt: remainsPaid ? input.currentActivatedAt : null,
  };
}
