import { describe, expect, test } from "bun:test";
import {
  commissionRuleIntervalsOverlap,
  commissionRuleStatusAt,
  isCommissionRuleEffectiveAt,
  normalizeCommissionRuleDraft,
} from "./commission-rule-policy";

const general = (start: string, end?: string) => ({
  trainerId: null,
  planId: "plan-1",
  startAt: new Date(start),
  endAt: end ? new Date(end) : null,
  active: true,
});

describe("commission rule policy", () => {
  test("valida porcentaje, monto y vigencia", () => {
    expect(normalizeCommissionRuleDraft({
      id_planes_pago: " plan-1 ",
      tipo_calculo: "percentage",
      valor_calculo: "12.5",
      fecha_inicio: "2026-07-01T00:00:00.000Z",
    }, new Date("2026-07-13T10:00:00.000Z"))).toMatchObject({
      planId: "plan-1",
      trainerId: null,
      calculationType: "PERCENTAGE",
      calculationValue: 12.5,
    });
    expect(() => normalizeCommissionRuleDraft({
      id_planes_pago: "plan-1",
      tipo_calculo: "PERCENTAGE",
      valor_calculo: 101,
    }, new Date())).toThrow("100%");
    expect(() => normalizeCommissionRuleDraft({
      id_planes_pago: "plan-1",
      tipo_calculo: "FIXED_AMOUNT",
      valor_calculo: 10,
      fecha_inicio: "2026-08-01T00:00:00.000Z",
      fecha_fin: "2026-08-01T00:00:00.000Z",
    }, new Date())).toThrow("posterior");
  });

  test("usa intervalos semiabiertos y permite reglas contiguas", () => {
    const first = general(
      "2026-01-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
    );
    const next = general("2026-04-01T00:00:00.000Z");
    expect(commissionRuleIntervalsOverlap(first, next)).toBe(false);
    expect(commissionRuleIntervalsOverlap(
      first,
      general("2026-03-31T23:59:59.000Z"),
    )).toBe(true);
  });

  test("una excepción de entrenador no solapa la regla general", () => {
    expect(commissionRuleIntervalsOverlap(
      general("2026-01-01T00:00:00.000Z"),
      {
        ...general("2026-01-01T00:00:00.000Z"),
        trainerId: "trainer-1",
      },
    )).toBe(false);
  });

  test("clasifica programada, vigente y finalizada en UTC", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    expect(commissionRuleStatusAt(
      general("2026-07-14T00:00:00.000Z"),
      now,
    )).toBe("PROGRAMADA");
    expect(isCommissionRuleEffectiveAt(
      general("2026-07-01T00:00:00.000Z"),
      now,
    )).toBe(true);
    expect(commissionRuleStatusAt(
      general(
        "2026-06-01T00:00:00.000Z",
        "2026-07-13T12:00:00.000Z",
      ),
      now,
    )).toBe("FINALIZADA");
  });
});
