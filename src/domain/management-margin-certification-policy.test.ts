import { createHash } from "crypto";
import { describe, expect, test } from "bun:test";
import {
  ManagementMarginCertificationPolicyError,
  prepareManagementMarginForCertification,
  readManagementMarginFromSignedSnapshot,
} from "./management-margin-certification-policy";

const cleanMargin = () => ({
  mes: "2026-06",
  estado_periodo: "PROVISIONAL",
  naturaleza: "MARGEN_GERENCIAL",
  certificado: false,
  cobertura: {
    membresias_evaluadas: 2,
    conceptos_costo_evaluados: 1,
    requieren_revision: 0,
    membresias_compartidas: 1,
    membresias_sin_entrenador: 1,
    conceptos_costo_sin_ingreso: 0,
    completa: true,
  },
  monedas: [{
    moneda_id: "cup",
    moneda_codigo: "CUP",
    atribucion: {
      costo_sin_plan: false,
      costo_sin_socio: false,
    },
  }],
  limitaciones: [
    "Los meses historicos son reconstrucciones provisionales.",
    "No mezcla monedas.",
  ],
});

describe("management margin certification policy", () => {
  test("prepara un margen limpio para el snapshot mensual", () => {
    const result = prepareManagementMarginForCertification(
      cleanMargin(),
      "2026-06",
    );
    expect(result.estado_periodo).toBe("CERTIFICADO");
    expect(result.certificado).toBeTrue();
    expect(result.cierre_tesoreria).toBeNull();
    expect(result.limitaciones).not.toContain(
      "Los meses historicos son reconstrucciones provisionales.",
    );
  });

  test("bloquea costos sin ingreso verificable antes de firmar", () => {
    const result = cleanMargin();
    result.cobertura.conceptos_costo_sin_ingreso = 1;
    result.cobertura.completa = false;
    expect(() => prepareManagementMarginForCertification(result, "2026-06"))
      .toThrow(ManagementMarginCertificationPolicyError);
  });

  test("bloquea atribucion incompleta de plan o socio", () => {
    const result = cleanMargin();
    result.monedas[0]!.atribucion.costo_sin_plan = true;
    expect(() => prepareManagementMarginForCertification(result, "2026-06"))
      .toThrow("margen por plan");
  });

  test("solo recupera snapshots version 3 del gimnasio y mes esperados", () => {
    const snapshot = JSON.stringify({
      version: 3,
      gym_id: "gym-1",
      mes: "2026-06",
      resultado_devengado: prepareManagementMarginForCertification(
        cleanMargin(),
        "2026-06",
      ),
    });
    const hash = createHash("sha256").update(snapshot).digest("hex");
    expect(readManagementMarginFromSignedSnapshot({
      snapshotJson: snapshot,
      expectedHash: hash,
      actualHash: hash,
      gymId: "gym-1",
      month: "2026-06",
    })?.result.certificado).toBeTrue();
    expect(readManagementMarginFromSignedSnapshot({
      snapshotJson: snapshot,
      expectedHash: hash,
      actualHash: hash,
      gymId: "gym-2",
      month: "2026-06",
    })).toBeNull();
    expect(readManagementMarginFromSignedSnapshot({
      snapshotJson: snapshot.replace("\"version\":3", "\"version\":2"),
      expectedHash: hash,
      actualHash: hash,
      gymId: "gym-1",
      month: "2026-06",
    })).toBeNull();
  });
});
