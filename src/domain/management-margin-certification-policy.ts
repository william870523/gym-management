export class ManagementMarginCertificationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementMarginCertificationPolicyError";
  }
}

type JsonRecord = Record<string, any>;

export type ManagementMarginCloseBlocker = {
  codigo: string;
  moneda_codigo: string | null;
  cantidad: number;
  mensaje: string;
};

const integer = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

export function managementMarginCloseBlockers(
  value: unknown,
  expectedMonth: string,
): ManagementMarginCloseBlocker[] {
  if (!value || typeof value !== "object") {
    return [{
      codigo: "RESULTADO_DEVENGADO_INVALIDO",
      moneda_codigo: null,
      cantidad: 1,
      mensaje: "El resultado devengado no tiene una estructura valida.",
    }];
  }
  const result = value as JsonRecord;
  if (result.mes !== expectedMonth || result.naturaleza !== "MARGEN_GERENCIAL") {
    return [{
      codigo: "RESULTADO_DEVENGADO_PERIODO_INVALIDO",
      moneda_codigo: null,
      cantidad: 1,
      mensaje: "El resultado devengado no corresponde al mes que se intenta firmar.",
    }];
  }
  const blockers: ManagementMarginCloseBlocker[] = [];
  const coverage = result.cobertura ?? {};
  const reviewCount = integer(coverage.requieren_revision);
  if (reviewCount > 0) {
    blockers.push({
      codigo: "RESULTADO_DEVENGADO_REVISION",
      moneda_codigo: null,
      cantidad: reviewCount,
      mensaje: `${reviewCount} concepto(s) del resultado devengado requieren revision.`,
    });
  }
  const orphanCosts = integer(coverage.conceptos_costo_sin_ingreso);
  if (orphanCosts > 0) {
    blockers.push({
      codigo: "COSTO_SIN_INGRESO",
      moneda_codigo: null,
      cantidad: orphanCosts,
      mensaje: `${orphanCosts} costo(s) de entrenador no tienen ingreso verificable.`,
    });
  }
  if (coverage.completa === false) {
    blockers.push({
      codigo: "RESULTADO_DEVENGADO_INCOMPLETO",
      moneda_codigo: null,
      cantidad: 1,
      mensaje: "El resultado devengado conserva cobertura incompleta.",
    });
  }
  for (const currency of Array.isArray(result.monedas) ? result.monedas : []) {
    const code = String(currency?.moneda_codigo ?? currency?.moneda_id ?? "moneda");
    const attribution = currency?.atribucion ?? {};
    if (attribution.costo_sin_plan === true) {
      blockers.push({
        codigo: "COSTO_SIN_PLAN",
        moneda_codigo: code,
        cantidad: 1,
        mensaje: `${code}: hay costo directo sin plan para el margen por plan.`,
      });
    }
    if (attribution.costo_sin_socio === true) {
      blockers.push({
        codigo: "COSTO_SIN_SOCIO",
        moneda_codigo: code,
        cantidad: 1,
        mensaje: `${code}: hay costo directo sin socio para el margen por socio.`,
      });
    }
  }
  return blockers;
}

export function managementMarginCertificationBlockers(
  value: unknown,
  expectedMonth: string,
) {
  return managementMarginCloseBlockers(value, expectedMonth)
    .map((blocker) => blocker.mensaje);
}

export function prepareManagementMarginForCertification(
  value: unknown,
  expectedMonth: string,
) {
  const blockers = managementMarginCertificationBlockers(value, expectedMonth);
  if (blockers.length > 0) {
    throw new ManagementMarginCertificationPolicyError(
      `No se puede certificar el resultado devengado: ${blockers.join(" ")}`,
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
      "Resultado devengado incluido integramente en el snapshot firmado del cierre mensual.",
    limitaciones: [
      ...limitations,
      "Ingreso, costo directo, fijo no distribuido y margen corresponden al corte congelado; no se recalculan al exportar.",
    ],
  };
}

export function readManagementMarginFromSignedSnapshot(input: {
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
    integer(snapshot.version) < 3 ||
    snapshot.gym_id !== input.gymId ||
    snapshot.mes !== input.month ||
    !snapshot.resultado_devengado ||
    typeof snapshot.resultado_devengado !== "object"
  ) {
    return null;
  }
  return {
    snapshot,
    result: snapshot.resultado_devengado as JsonRecord,
  };
}
