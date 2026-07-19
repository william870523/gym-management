export type MoneyInput = string | number;

export interface SettlementApplicationInput {
  cuota_id: string;
  monto: MoneyInput;
}

export interface NormalizedSettlementApplication {
  installmentId: string;
  amountMinor: bigint;
  amount: string;
}

export interface FixedSettlementApplicationInput {
  obligacion_id: string;
  monto: MoneyInput;
}

export interface NormalizedFixedSettlementApplication {
  obligationId: string;
  amountMinor: bigint;
  amount: string;
}

export function normalizeSettlementOperationId(value: unknown) {
  const operationId = String(value ?? "").trim();
  if (!operationId) throw new Error("La operación de liquidación es obligatoria.");
  if (operationId.length > 191) {
    throw new Error("La operación de liquidación excede 191 caracteres.");
  }
  return operationId;
}

export function normalizeSettlementReason(value: unknown) {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 8) {
    throw new Error("Indique un motivo de al menos 8 caracteres.");
  }
  if (reason.length > 500) throw new Error("El motivo excede 500 caracteres.");
  return reason;
}

export function moneyToMinorUnits(value: MoneyInput) {
  const raw = typeof value === "number" ? value.toString() : value.trim();
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new Error("Cada monto debe ser positivo y tener como máximo 2 decimales.");
  }
  const whole = BigInt(match[1]);
  const decimals = (match[2] ?? "").padEnd(2, "0");
  return whole * 100n + BigInt(decimals || "0");
}

export function minorUnitsToMoney(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function normalizeSettlementApplications(
  input: unknown,
): NormalizedSettlementApplication[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Seleccione al menos una cuota para liquidar.");
  }
  if (input.length > 100) {
    throw new Error("Una liquidación admite como máximo 100 cuotas.");
  }
  const seen = new Set<string>();
  return input.map((raw) => {
    const row = raw as Partial<SettlementApplicationInput> | null;
    const installmentId = String(row?.cuota_id ?? "").trim();
    if (!installmentId) throw new Error("Todas las aplicaciones requieren una cuota.");
    if (seen.has(installmentId)) {
      throw new Error("Una cuota no puede repetirse en la misma liquidación.");
    }
    seen.add(installmentId);
    const amountMinor = moneyToMinorUnits(row?.monto as MoneyInput);
    if (amountMinor <= 0n) throw new Error("El monto aplicado debe ser mayor que cero.");
    return {
      installmentId,
      amountMinor,
      amount: minorUnitsToMoney(amountMinor),
    };
  });
}

export function normalizeOptionalSettlementApplications(
  input: unknown,
): NormalizedSettlementApplication[] {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input) && input.length === 0) return [];
  return normalizeSettlementApplications(input);
}

export function normalizeFixedSettlementApplications(
  input: unknown,
): NormalizedFixedSettlementApplication[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error("Las aplicaciones fijas deben enviarse como una lista.");
  }
  if (input.length > 100) {
    throw new Error("Una liquidación admite como máximo 100 obligaciones fijas.");
  }
  const seen = new Set<string>();
  return input.map((raw) => {
    const row = raw as Partial<FixedSettlementApplicationInput> | null;
    const obligationId = String(row?.obligacion_id ?? "").trim();
    if (!obligationId) {
      throw new Error("Todas las aplicaciones fijas requieren una obligación.");
    }
    if (seen.has(obligationId)) {
      throw new Error("Una obligación fija no puede repetirse en la misma liquidación.");
    }
    seen.add(obligationId);
    const amountMinor = moneyToMinorUnits(row?.monto as MoneyInput);
    if (amountMinor <= 0n) throw new Error("El monto aplicado debe ser mayor que cero.");
    return {
      obligationId,
      amountMinor,
      amount: minorUnitsToMoney(amountMinor),
    };
  });
}

export function assertSettlementApplicationCount(
  commissions: NormalizedSettlementApplication[],
  fixed: NormalizedFixedSettlementApplication[],
) {
  const total = commissions.length + fixed.length;
  if (total === 0) {
    throw new Error("Seleccione al menos un concepto para liquidar.");
  }
  if (total > 100) {
    throw new Error("Una liquidación admite como máximo 100 conceptos.");
  }
  return total;
}

export function installmentState(amountMinor: bigint, appliedMinor: bigint) {
  if (amountMinor <= 0n) throw new Error("La cuota debe tener un monto positivo.");
  if (appliedMinor < 0n || appliedMinor > amountMinor) {
    throw new Error("Las aplicaciones exceden el saldo de la cuota.");
  }
  if (appliedMinor === 0n) return "PENDIENTE" as const;
  if (appliedMinor === amountMinor) return "PAGADO" as const;
  return "PARCIAL" as const;
}

export function assertSettlementScope(
  rows: Array<{ id_entrenador: string; moneda_id: string }>,
) {
  if (rows.length === 0) throw new Error("No existen cuotas para liquidar.");
  const trainerId = rows[0].id_entrenador;
  const currencyId = rows[0].moneda_id;
  if (rows.some((row) => row.id_entrenador !== trainerId)) {
    throw new Error("Una liquidación solo puede corresponder a un entrenador.");
  }
  if (rows.some((row) => row.moneda_id !== currencyId)) {
    throw new Error("Una liquidación no puede mezclar monedas.");
  }
  return { trainerId, currencyId };
}

export function settlementIntentSignature(input: {
  trainerId: string;
  currencyId: string;
  accountId: string;
  paymentTypeId: string;
  applications: NormalizedSettlementApplication[];
  fixedApplications?: NormalizedFixedSettlementApplication[];
}) {
  const applications = [...input.applications]
    .sort((a, b) => a.installmentId.localeCompare(b.installmentId))
    .map((row) => `${row.installmentId}:${row.amount}`)
    .join("|");
  const legacy = [
    input.trainerId,
    input.currencyId,
    input.accountId,
    input.paymentTypeId,
    applications,
  ].join("#");
  const fixedApplications = [...(input.fixedApplications ?? [])]
    .sort((a, b) => a.obligationId.localeCompare(b.obligationId))
    .map((row) => `${row.obligationId}:${row.amount}`)
    .join("|");
  return fixedApplications ? `${legacy}#FIJO:${fixedApplications}` : legacy;
}
