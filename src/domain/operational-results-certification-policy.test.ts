import { createHash } from "crypto";
import { describe, expect, test } from "bun:test";
import {
  OperationalResultsCertificationPolicyError,
  prepareOperationalResultsForCertification,
  readOperationalResultsFromSignedSnapshot,
} from "./operational-results-certification-policy";

const cleanResult = () => ({
  mes: "2026-06",
  estado_periodo: "PROVISIONAL",
  naturaleza: "RESULTADO_OPERATIVO_DE_CAJA",
  certificado: false,
  monedas: [{
    moneda_id: "cup",
    moneda_codigo: "CUP",
    calidad: {
      movimientos_sin_cuenta: 0,
      clasificacion_pendiente: 0,
      revisiones_pendientes: 0,
      jornadas_por_cerrar: 0,
    },
    obligaciones: { disponible: true, revisiones_pendientes: 0 },
  }],
  limitaciones: ["Reconstrucción provisional hasta R3.", "No representa utilidad."],
});

describe("operational results certification policy", () => {
  test("prepara un resultado limpio sin conservar referencias a otro ciclo", () => {
    const result = prepareOperationalResultsForCertification(cleanResult(), "2026-06");
    expect(result.estado_periodo).toBe("CERTIFICADO");
    expect(result.certificado).toBeTrue();
    expect(result.cierre_tesoreria).toBeNull();
    expect(result.limitaciones).not.toContain("Reconstrucción provisional hasta R3.");
  });

  test("bloquea incidencias financieras antes de firmar", () => {
    const result = cleanResult();
    result.monedas[0]!.calidad.clasificacion_pendiente = 2;
    expect(() => prepareOperationalResultsForCertification(result, "2026-06"))
      .toThrow(OperationalResultsCertificationPolicyError);
  });

  test("solo recupera snapshots versión 2 del gimnasio y mes esperados", () => {
    const snapshot = JSON.stringify({
      version: 2,
      gym_id: "gym-1",
      mes: "2026-06",
      resultado_operativo: prepareOperationalResultsForCertification(
        cleanResult(),
        "2026-06",
      ),
    });
    const hash = createHash("sha256").update(snapshot).digest("hex");
    expect(readOperationalResultsFromSignedSnapshot({
      snapshotJson: snapshot,
      expectedHash: hash,
      actualHash: hash,
      gymId: "gym-1",
      month: "2026-06",
    })?.result.certificado).toBeTrue();
    expect(readOperationalResultsFromSignedSnapshot({
      snapshotJson: snapshot,
      expectedHash: hash,
      actualHash: hash,
      gymId: "gym-2",
      month: "2026-06",
    })).toBeNull();
  });
});
