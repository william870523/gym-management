export class OperationalResultsCertificationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalResultsCertificationPolicyError";
  }
}

type JsonRecord = Record<string, any>;

export type OperationalResultsCloseBlocker = {
  codigo: string;
  moneda_codigo: string | null;
  cantidad: number;
  mensaje: string;
};

const integer = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

export function operationalResultsCloseBlockers(
  value: unknown,
  expectedMonth: string,
): OperationalResultsCloseBlocker[] {
  if (!value || typeof value !== "object") {
    return [{
      codigo: "RESULTADO_OPERATIVO_INVALIDO",
      moneda_codigo: null,
      cantidad: 1,
      mensaje: "El Resultado de caja no tiene una estructura válida.",
    }];
  }
  const result = value as JsonRecord;
  if (
    result.mes !== expectedMonth ||
    result.naturaleza !== "RESULTADO_OPERATIVO_DE_CAJA"
  ) {
    return [{
      codigo: "RESULTADO_OPERATIVO_PERIODO_INVALIDO",
      moneda_codigo: null,
      cantidad: 1,
      mensaje: "El Resultado de caja no corresponde al mes que se intenta firmar.",
    }];
  }
  const blockers: OperationalResultsCloseBlocker[] = [];
  for (const currency of Array.isArray(result.monedas) ? result.monedas : []) {
    const code = String(currency?.moneda_codigo ?? currency?.moneda_id ?? "moneda");
    const quality = currency?.calidad ?? {};
    const obligations = currency?.obligaciones ?? {};
    if (obligations.disponible !== true) {
      blockers.push({
        codigo: "OBLIGACIONES_SIN_CORTE",
        moneda_codigo: code,
        cantidad: 1,
        mensaje: `${code}: las obligaciones no tienen un corte comercial disponible.`,
      });
    }
    const pendingClassification = integer(quality.clasificacion_pendiente);
    if (pendingClassification > 0) {
      blockers.push({
        codigo: "CLASIFICACION_OPERATIVA_PENDIENTE",
        moneda_codigo: code,
        cantidad: pendingClassification,
        mensaje: `${code}: ${pendingClassification} movimiento(s) pendientes de clasificación operativa.`,
      });
    }
    const obligationReviews = integer(obligations.revisiones_pendientes);
    if (obligationReviews > 0) {
      blockers.push({
        codigo: "OBLIGACIONES_PENDIENTES_REVISION",
        moneda_codigo: code,
        cantidad: obligationReviews,
        mensaje: `${code}: ${obligationReviews} obligación(es) de entrenador por revisar.`,
      });
    }
  }
  return blockers;
}

export function operationalResultsCertificationBlockers(
  value: unknown,
  expectedMonth: string,
) {
  if (!value || typeof value !== "object") {
    return ["El resultado operativo no tiene una estructura válida."];
  }
  const result = value as JsonRecord;
  const blockers: string[] = [];
  if (result.mes !== expectedMonth) {
    blockers.push("El resultado operativo no corresponde al mes que se intenta firmar.");
  }
  if (result.naturaleza !== "RESULTADO_OPERATIVO_DE_CAJA") {
    blockers.push("La proyección no corresponde al Resultado operativo de caja.");
  }
  if (result.estado_periodo === "REQUIERE_REVISION") {
    blockers.push("El Resultado de caja conserva incidencias que deben resolverse.");
  }
  const currencies = Array.isArray(result.monedas) ? result.monedas : [];
  for (const currency of currencies) {
    const code = String(currency?.moneda_codigo ?? currency?.moneda_id ?? "moneda");
    const quality = currency?.calidad ?? {};
    const obligations = currency?.obligaciones ?? {};
    if (obligations.disponible !== true) {
      blockers.push(`${code}: las obligaciones no tienen un corte comercial disponible.`);
    }
    if (integer(quality.movimientos_sin_cuenta) > 0) {
      blockers.push(`${code}: existen movimientos sin cuenta.`);
    }
    if (integer(quality.clasificacion_pendiente) > 0) {
      blockers.push(`${code}: existen movimientos pendientes de clasificación.`);
    }
    if (integer(quality.revisiones_pendientes) > 0) {
      blockers.push(`${code}: existen movimientos marcados para revisión.`);
    }
    if (integer(quality.jornadas_por_cerrar) > 0) {
      blockers.push(`${code}: existen jornadas de cuenta por cerrar.`);
    }
    if (integer(obligations.revisiones_pendientes) > 0) {
      blockers.push(`${code}: existen obligaciones de entrenador por revisar.`);
    }
  }
  return [...new Set(blockers)];
}

export function prepareOperationalResultsForCertification(
  value: unknown,
  expectedMonth: string,
) {
  const blockers = operationalResultsCertificationBlockers(value, expectedMonth);
  if (blockers.length > 0) {
    throw new OperationalResultsCertificationPolicyError(
      `No se puede certificar el Resultado de caja: ${blockers.join(" ")}`,
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
    cierre_tesoreria: null,
    nota_certificacion:
      "Proyección incluida íntegramente en el snapshot firmado del cierre mensual.",
    limitaciones: [
      ...limitations,
      "Las obligaciones y devoluciones corresponden al corte congelado; no se recalculan al exportar.",
    ],
  };
}

export function readOperationalResultsFromSignedSnapshot(input: {
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
    integer(snapshot.version) < 2 ||
    snapshot.gym_id !== input.gymId ||
    snapshot.mes !== input.month ||
    !snapshot.resultado_operativo ||
    typeof snapshot.resultado_operativo !== "object"
  ) {
    return null;
  }
  return {
    snapshot,
    result: snapshot.resultado_operativo as JsonRecord,
  };
}
