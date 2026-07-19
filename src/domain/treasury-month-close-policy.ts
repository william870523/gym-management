import { normalizeTreasuryOperationId, parseTreasuryMonth } from "./treasury-ledger-policy";

export type MonthlyCloseCurrencyReadiness = {
  moneda_codigo: string;
  jornadas_por_cerrar: number;
  solicitudes_pendientes: number;
  movimientos_tardios_pendientes: number;
  revisiones_pendientes: number;
  cuentas_sin_cierre: number;
  movimientos_sin_cuenta: number;
};

export type MonthlyCloseBlocker = {
  codigo: string;
  moneda_codigo: string | null;
  cantidad: number;
  mensaje: string;
};

export class TreasuryMonthClosePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryMonthClosePolicyError";
  }
}

export function normalizeMonthlyCloseOperationId(value: unknown) {
  return normalizeTreasuryOperationId(value);
}

export function normalizeMonthlyCloseReason(value: unknown, action: "cerrar" | "reabrir") {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 12) {
    throw new TreasuryMonthClosePolicyError(
      `El motivo para ${action} el mes debe explicar la decisión con al menos 12 caracteres.`,
    );
  }
  if (reason.length > 500) {
    throw new TreasuryMonthClosePolicyError("El motivo no puede superar 500 caracteres.");
  }
  return reason;
}

export function normalizeMonthlyCloseRole(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function canCloseTreasuryMonth(roleValue: unknown) {
  const role = normalizeMonthlyCloseRole(roleValue);
  return ["admin", "administrador", "accounting", "contabilidad"].includes(role);
}

export function canReopenTreasuryMonth(roleValue: unknown) {
  const role = normalizeMonthlyCloseRole(roleValue);
  return role === "admin" || role === "administrador";
}

export function monthClosePeriod(monthValue: unknown) {
  return parseTreasuryMonth(monthValue);
}

export function assertCompletedMonth(monthValue: unknown, currentBusinessDate: Date) {
  const period = monthClosePeriod(monthValue);
  if (period.endExclusive.getTime() > currentBusinessDate.getTime()) {
    throw new TreasuryMonthClosePolicyError(
      "El cierre mensual solo puede firmarse cuando el mes comercial ha terminado.",
    );
  }
  return period;
}

export function monthlyCloseBlockers(
  currencies: MonthlyCloseCurrencyReadiness[],
): MonthlyCloseBlocker[] {
  const definitions: Array<{
    field: keyof Omit<MonthlyCloseCurrencyReadiness, "moneda_codigo">;
    code: string;
    label: string;
  }> = [
    {
      field: "jornadas_por_cerrar",
      code: "JORNADAS_ABIERTAS",
      label: "jornada(s) de cuenta todavía abiertas",
    },
    {
      field: "solicitudes_pendientes",
      code: "APROBACIONES_PENDIENTES",
      label: "solicitud(es) de arqueo pendientes",
    },
    {
      field: "movimientos_tardios_pendientes",
      code: "TARDIOS_PENDIENTES",
      label: "movimiento(s) tardíos sin conciliar",
    },
    {
      field: "revisiones_pendientes",
      code: "REVISIONES_PENDIENTES",
      label: "movimiento(s) que requieren revisión",
    },
    {
      field: "cuentas_sin_cierre",
      code: "CUENTAS_SIN_CIERRE",
      label: "cuenta(s) con actividad sin cierre",
    },
    {
      field: "movimientos_sin_cuenta",
      code: "MOVIMIENTOS_SIN_CUENTA",
      label: "movimiento(s) sin cuenta asignada",
    },
  ];
  const blockers: MonthlyCloseBlocker[] = [];
  for (const currency of currencies) {
    for (const definition of definitions) {
      const count = Number(currency[definition.field] ?? 0);
      if (count <= 0) continue;
      blockers.push({
        codigo: definition.code,
        moneda_codigo: currency.moneda_codigo,
        cantidad: count,
        mensaje: `${currency.moneda_codigo}: ${count} ${definition.label}.`,
      });
    }
  }
  return blockers;
}

export function assertMonthlyCloseReady(blockers: MonthlyCloseBlocker[]) {
  if (!blockers.length) return;
  throw new TreasuryMonthClosePolicyError(
    `El mes todavía no está listo para cerrar: ${blockers.map((item) => item.mensaje).join(" ")}`,
  );
}
