import {
  decimalToUnits,
  MoneyContractError,
  unitsToDecimal,
  type DecimalInput,
} from "./money";

export class TreasuryLedgerPolicyError extends MoneyContractError {}

export type MoneyInput = DecimalInput;
export type TreasuryManualKind =
  | "GASTO"
  | "RETIRO"
  | "DEPOSITO"
  | "TRANSFERENCIA";

export type TreasuryCloseApprovalPolicy = {
  version: 1;
  defaultTolerance: string;
  currencyTolerances: Record<string, string>;
  submitterRoles: string[];
  approverRoles: string[];
  allowSelfApproval: boolean;
  requireReasonForDifference: boolean;
};

export const defaultTreasuryCloseApprovalPolicy: TreasuryCloseApprovalPolicy = {
  version: 1,
  defaultTolerance: "0.00",
  currencyTolerances: {},
  submitterRoles: [
    "admin",
    "administrador",
    "accounting",
    "contabilidad",
    "reception",
    "recepcion",
  ],
  approverRoles: ["admin", "administrador", "accounting", "contabilidad"],
  allowSelfApproval: false,
  requireReasonForDifference: true,
};

const treasuryManualKinds = new Set<TreasuryManualKind>([
  "GASTO",
  "RETIRO",
  "DEPOSITO",
  "TRANSFERENCIA",
]);

export function treasuryMoneyToMinor(value: MoneyInput): bigint {
  if (typeof value === "bigint") return value;
  try {
    return decimalToUnits(value, 2);
  } catch (error) {
    throw new TreasuryLedgerPolicyError(
      error instanceof Error ? error.message : "El importe no es válido.",
    );
  }
}

export function treasuryMinorToMoney(value: bigint): string {
  return unitsToDecimal(value, 2);
}

export function normalizeTreasuryRole(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeTreasuryCloseApprovalPolicy(
  value: unknown,
): TreasuryCloseApprovalPolicy {
  const input = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const money = (raw: unknown, label: string) => {
    const minor = treasuryMoneyToMinor((raw ?? "0") as MoneyInput);
    if (minor < 0n) {
      throw new TreasuryLedgerPolicyError(`${label} no puede ser negativa.`);
    }
    return treasuryMinorToMoney(minor);
  };
  const roles = (raw: unknown, fallback: string[], label: string) => {
    const normalized = (Array.isArray(raw) ? raw : fallback)
      .map(normalizeTreasuryRole)
      .filter(Boolean);
    const unique = [...new Set(normalized)];
    if (!unique.length) {
      throw new TreasuryLedgerPolicyError(`${label} requiere al menos un rol.`);
    }
    return unique;
  };
  const rawCurrency = input.currencyTolerances ?? input.currency_tolerances;
  const currencyTolerances: Record<string, string> = {};
  if (rawCurrency && typeof rawCurrency === "object" && !Array.isArray(rawCurrency)) {
    for (const [currencyId, tolerance] of Object.entries(rawCurrency)) {
      const id = currencyId.trim();
      if (!id || id.length > 191) {
        throw new TreasuryLedgerPolicyError("La moneda de una tolerancia no es válida.");
      }
      currencyTolerances[id] = money(tolerance, `La tolerancia de ${id}`);
    }
  }
  return {
    version: 1,
    defaultTolerance: money(
      input.defaultTolerance ?? input.default_tolerance ?? "0",
      "La tolerancia predeterminada",
    ),
    currencyTolerances,
    submitterRoles: roles(
      input.submitterRoles ?? input.submitter_roles,
      defaultTreasuryCloseApprovalPolicy.submitterRoles,
      "La política de solicitud",
    ),
    approverRoles: roles(
      input.approverRoles ?? input.approver_roles,
      defaultTreasuryCloseApprovalPolicy.approverRoles,
      "La política de aprobación",
    ),
    allowSelfApproval:
      input.allowSelfApproval === true || input.allow_self_approval === true,
    requireReasonForDifference:
      input.requireReasonForDifference !== false &&
      input.require_reason_for_difference !== false,
  };
}

export function treasuryCloseToleranceMinor(
  policy: TreasuryCloseApprovalPolicy,
  currencyId: string,
): bigint {
  return treasuryMoneyToMinor(
    policy.currencyTolerances[currencyId] ?? policy.defaultTolerance,
  );
}

export function treasuryCloseNeedsApproval(
  differenceMinor: bigint,
  toleranceMinor: bigint,
): boolean {
  const absolute = differenceMinor < 0n ? -differenceMinor : differenceMinor;
  return absolute > toleranceMinor;
}

export function treasuryRoleAllowed(
  role: unknown,
  allowedRoles: string[],
): boolean {
  const normalized = normalizeTreasuryRole(role);
  return allowedRoles.map(normalizeTreasuryRole).includes(normalized);
}

export function normalizeTreasuryVarianceReason(
  value: unknown,
  required: boolean,
): string | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    if (required) {
      throw new TreasuryLedgerPolicyError(
        "Explique la diferencia antes de solicitar la aprobación.",
      );
    }
    return null;
  }
  if (normalized.length < 5 || normalized.length > 500) {
    throw new TreasuryLedgerPolicyError(
      "La justificación debe tener entre 5 y 500 caracteres.",
    );
  }
  return normalized;
}

export function normalizeTreasuryOperationId(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length < 8 || normalized.length > 191) {
    throw new TreasuryLedgerPolicyError("La operación de Tesorería no es válida.");
  }
  return normalized;
}

export function normalizeTreasuryReconciliationIntent(input: {
  closeId: unknown;
  reason: unknown;
  evidence: unknown;
}) {
  const closeId = String(input.closeId ?? "").trim();
  if (closeId.length < 8 || closeId.length > 191) {
    throw new TreasuryLedgerPolicyError("El cierre a conciliar no es válido.");
  }
  const text = (value: unknown, label: string, min: number, max: number) => {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
    if (normalized.length < min || normalized.length > max) {
      throw new TreasuryLedgerPolicyError(
        `${label} debe tener entre ${min} y ${max} caracteres.`,
      );
    }
    return normalized;
  };
  return {
    closeId,
    reason: text(input.reason, "El motivo", 5, 500),
    evidence: text(input.evidence, "La evidencia o referencia", 3, 300),
  };
}

export function normalizeTreasuryManualIntent(input: {
  kind: unknown;
  concept: unknown;
  description?: unknown;
  evidence: unknown;
  amount: MoneyInput;
  originAccountId?: unknown;
  destinationAccountId?: unknown;
  originPaymentTypeId?: unknown;
  destinationPaymentTypeId?: unknown;
}) {
  const kind = String(input.kind ?? "").trim().toUpperCase() as TreasuryManualKind;
  if (!treasuryManualKinds.has(kind)) {
    throw new TreasuryLedgerPolicyError(
      "Seleccione gasto, retiro, depósito o transferencia.",
    );
  }
  const text = (value: unknown, label: string, min: number, max: number) => {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
    if (normalized.length < min || normalized.length > max) {
      throw new TreasuryLedgerPolicyError(
        `${label} debe tener entre ${min} y ${max} caracteres.`,
      );
    }
    return normalized;
  };
  const optional = (value: unknown, max: number) => {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
    if (normalized.length > max) {
      throw new TreasuryLedgerPolicyError(
        `La descripción no puede superar ${max} caracteres.`,
      );
    }
    return normalized || null;
  };
  const id = (value: unknown) => String(value ?? "").trim() || null;
  const amountMinor = treasuryMoneyToMinor(input.amount);
  if (amountMinor <= 0n) {
    throw new TreasuryLedgerPolicyError("El importe debe ser mayor que cero.");
  }
  const originAccountId = id(input.originAccountId);
  const destinationAccountId = id(input.destinationAccountId);
  const originPaymentTypeId = id(input.originPaymentTypeId);
  const destinationPaymentTypeId = id(input.destinationPaymentTypeId);
  const needsOrigin = kind !== "DEPOSITO";
  const needsDestination = kind === "DEPOSITO" || kind === "TRANSFERENCIA";
  if (needsOrigin && (!originAccountId || !originPaymentTypeId)) {
    throw new TreasuryLedgerPolicyError(
      "Seleccione la cuenta y el método de salida.",
    );
  }
  if (needsDestination && (!destinationAccountId || !destinationPaymentTypeId)) {
    throw new TreasuryLedgerPolicyError(
      "Seleccione la cuenta y el método de entrada.",
    );
  }
  if (
    kind === "TRANSFERENCIA" &&
    originAccountId === destinationAccountId
  ) {
    throw new TreasuryLedgerPolicyError(
      "La transferencia requiere dos cuentas diferentes.",
    );
  }
  return {
    kind,
    concept: text(input.concept, "El concepto", 3, 120),
    description: optional(input.description, 500),
    evidence: text(input.evidence, "La evidencia o referencia", 3, 300),
    amountMinor,
    amount: treasuryMinorToMoney(amountMinor),
    originAccountId: needsOrigin ? originAccountId : null,
    destinationAccountId: needsDestination ? destinationAccountId : null,
    originPaymentTypeId: needsOrigin ? originPaymentTypeId : null,
    destinationPaymentTypeId: needsDestination
      ? destinationPaymentTypeId
      : null,
  };
}

export function parseTreasuryBusinessDate(value: unknown): Date {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new TreasuryLedgerPolicyError("La fecha de negocio debe usar AAAA-MM-DD.");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new TreasuryLedgerPolicyError("La fecha de negocio no es válida.");
  }
  return date;
}

export function parseTreasuryMonth(value: unknown): {
  month: string;
  start: Date;
  endExclusive: Date;
} {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new TreasuryLedgerPolicyError("El mes contable debe usar AAAA-MM.");
  }
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 7) !== month
  ) {
    throw new TreasuryLedgerPolicyError("El mes contable no es válido.");
  }
  const endExclusive = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
  );
  return { month, start, endExclusive };
}

export function treasuryCloseAmounts(input: {
  opening: MoneyInput;
  counted: MoneyInput;
  entriesMinor: bigint;
  exitsMinor: bigint;
}) {
  const openingMinor = treasuryMoneyToMinor(input.opening);
  const countedMinor = treasuryMoneyToMinor(input.counted);
  if (openingMinor < 0n || countedMinor < 0n) {
    throw new TreasuryLedgerPolicyError("Los saldos del arqueo no pueden ser negativos.");
  }
  if (input.entriesMinor < 0n || input.exitsMinor < 0n) {
    throw new TreasuryLedgerPolicyError("Las entradas y salidas no pueden ser negativas.");
  }
  const expectedMinor = openingMinor + input.entriesMinor - input.exitsMinor;
  const differenceMinor = countedMinor - expectedMinor;
  return {
    openingMinor,
    countedMinor,
    expectedMinor,
    differenceMinor,
    opening: treasuryMinorToMoney(openingMinor),
    counted: treasuryMinorToMoney(countedMinor),
    expected: treasuryMinorToMoney(expectedMinor),
    difference: treasuryMinorToMoney(differenceMinor),
  };
}
