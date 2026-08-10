import { describe, expect, test } from "bun:test";
import { resolveInstallmentReversalProjection } from "./payment-reversal.service";

describe("reversión de una cuota de membresía", () => {
  test("conserva activa la membresía y vuelve a la última cobertura pagada", () => {
    const activatedAt = new Date("2026-07-20T17:43:58.998Z");
    const result = resolveInstallmentReversalProjection({
      remainingPaid: 3600,
      currentState: "ACTIVA",
      currentActivatedAt: activatedAt,
      quotas: [
        { estado: "PAGADA", fecha_cobertura_fin: new Date("2026-08-19T00:00:00.000Z") },
        { estado: "ANTICIPADA", fecha_cobertura_fin: new Date("2026-09-18T00:00:00.000Z") },
        { estado: "PENDIENTE", fecha_cobertura_fin: new Date("2026-10-18T00:00:00.000Z") },
      ],
    });
    expect(result).toEqual({ paidAmount: 3600, state: "ACTIVA", activatedAt, coverageEnd: new Date("2026-09-18T00:00:00.000Z") });
  });
});
