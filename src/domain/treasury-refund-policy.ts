export type TreasuryRefundAction = "CONFIRMAR" | "RECHAZAR_ACREDITAR";

export class TreasuryRefundPolicyError extends Error {}

export function normalizeTreasuryRefundAction(value: unknown): TreasuryRefundAction {
  const action = String(value ?? "").trim().toUpperCase();
  if (action !== "CONFIRMAR" && action !== "RECHAZAR_ACREDITAR") {
    throw new TreasuryRefundPolicyError("La decisión de Tesorería no es válida.");
  }
  return action;
}

export function normalizeTreasuryRefundReason(value: unknown) {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 8) {
    throw new TreasuryRefundPolicyError("Explique la decisión de Tesorería con al menos 8 caracteres.");
  }
  if (reason.length > 500) {
    throw new TreasuryRefundPolicyError("La explicación de Tesorería no puede superar 500 caracteres.");
  }
  return reason;
}

export function assertTreasuryRefundOutput(input: {
  action: TreasuryRefundAction;
  amountMinor: number;
  accountId?: unknown;
  paymentTypeId?: unknown;
}) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new TreasuryRefundPolicyError("El reembolso debe tener un importe positivo y exacto.");
  }
  if (input.action === "CONFIRMAR") {
    if (!String(input.accountId ?? "").trim()) {
      throw new TreasuryRefundPolicyError("Seleccione la cuenta de salida.");
    }
    if (!String(input.paymentTypeId ?? "").trim()) {
      throw new TreasuryRefundPolicyError("Seleccione el método de salida.");
    }
  }
}
