/**
 * R4.6 — Certificación del gasto devengado dentro del cierre mensual firmado.
 *
 * Sigue el mismo contrato que la certificación del margen gerencial (R4.4): el
 * informe se congela íntegro dentro del snapshot que se firma con SHA-256, y al
 * leerlo se exige que el snapshot corresponda al gimnasio, al mes y a una
 * versión que ya incluya gasto (v4 en adelante).
 */

export class GovernedExpenseCertificationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernedExpenseCertificationPolicyError";
  }
}

type JsonRecord = Record<string, any>;

const integer = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

/** Primera versión de snapshot que congela el gasto devengado. */
export const GOVERNED_EXPENSE_SNAPSHOT_VERSION = 4;

export function governedExpenseCertificationBlockers(
  value: unknown,
  expectedMonth: string,
) {
  if (!value || typeof value !== "object") {
    return ["El gasto devengado no tiene una estructura valida."];
  }
  const result = value as JsonRecord;
  if (
    result.mes !== expectedMonth ||
    result.naturaleza !== "GASTO_DEVENGADO_GOBERNADO"
  ) {
    return ["El gasto devengado no corresponde al mes que se intenta firmar."];
  }
  // No se bloquea por gastos pendientes de pago ni por pagos de otro mes: el
  // devengo del período está definido igual y esas dos situaciones son
  // operación normal del gimnasio, no un defecto de cobertura.
  return [] as string[];
}

export function prepareGovernedExpenseForCertification(
  value: unknown,
  expectedMonth: string,
) {
  const blockers = governedExpenseCertificationBlockers(value, expectedMonth);
  if (blockers.length > 0) {
    throw new GovernedExpenseCertificationPolicyError(
      `No se puede certificar el gasto devengado: ${blockers.join(" ")}`,
    );
  }
  const result = value as JsonRecord;
  const limitations = Array.isArray(result.limitaciones)
    ? result.limitaciones
        .map(String)
        .filter((item: string) => !item.toLowerCase().includes("provisional"))
    : [];
  return {
    ...result,
    estado_periodo: "CERTIFICADO",
    certificado: true,
    nota_certificacion:
      "Gasto devengado incluido integramente en el snapshot firmado del cierre mensual.",
    limitaciones: [
      ...limitations,
      "El devengado, lo pagado y lo pendiente corresponden al corte congelado; no se recalculan al exportar.",
    ],
  };
}

export function readGovernedExpenseFromSignedSnapshot(input: {
  snapshotJson: string;
  expectedHash: string;
  actualHash: string;
  gymId: string;
  month: string;
}) {
  let snapshot: JsonRecord;
  try {
    snapshot = JSON.parse(input.snapshotJson) as JsonRecord;
  } catch {
    return null;
  }
  if (
    input.actualHash !== input.expectedHash ||
    integer(snapshot.version) < GOVERNED_EXPENSE_SNAPSHOT_VERSION ||
    snapshot.gym_id !== input.gymId ||
    snapshot.mes !== input.month ||
    !snapshot.gasto_devengado ||
    typeof snapshot.gasto_devengado !== "object"
  ) {
    return null;
  }
  return {
    snapshot,
    result: snapshot.gasto_devengado as JsonRecord,
  };
}
