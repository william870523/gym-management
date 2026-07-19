import { describe, expect, test } from "bun:test";
import {
  buildMembershipRevenueReport,
  type MembershipRevenueSnapshot,
} from "./membership-revenue-policy";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const instant = (value: string) => new Date(value);

function membership(
  overrides: Partial<MembershipRevenueSnapshot> = {},
): MembershipRevenueSnapshot {
  return {
    membershipId: "membership-1",
    clientId: "client-1",
    clientName: "Cliente Demo",
    planId: "plan-1",
    planName: "Plan trimestral",
    currencyId: "cup",
    currencyCode: "CUP",
    price: "900.00",
    durationDays: 90,
    start: day("2026-01-01"),
    endExclusive: day("2026-04-01"),
    state: "VENCIDA",
    origin: "ALTA",
    reconstructed: false,
    createdAt: instant("2026-01-01T12:00:00.000Z"),
    funding: [{
      kind: "EFECTIVO",
      amount: "900.00",
      occurredAt: instant("2026-01-01T12:00:00.000Z"),
      createdAt: instant("2026-01-01T12:00:00.000Z"),
      deletedAt: null,
    }],
    pauses: [],
    adjustments: [],
    ...overrides,
  };
}

describe("remote membership revenue policy parity", () => {
  test("reparte un plan multimeses por días de servicio y no por fecha de cobro", () => {
    const result = buildMembershipRevenueReport({
      month: "2026-02",
      currentBusinessDate: day("2026-04-10"),
      memberships: [membership()],
    });
    const cup = result.monedas[0]!;
    expect(cup.financiacion_mes.efectivo_aplicado).toBe("0.00");
    expect(cup.ingreso_devengado_mes).toBe("280.00");
    expect(cup.ingreso_devengado_acumulado).toBe("590.00");
    expect(cup.saldo_servicio_pendiente).toBe("310.00");
    expect(cup.membresias[0]?.dias_servicio_mes).toBe(28);
  });

  test("una pausa detiene el reconocimiento sin perder el saldo futuro", () => {
    const result = buildMembershipRevenueReport({
      month: "2026-07",
      currentBusinessDate: day("2026-07-31"),
      memberships: [membership({
        price: "300.00",
        durationDays: 30,
        start: day("2026-07-01"),
        endExclusive: day("2026-08-10"),
        state: "ACTIVA",
        funding: [{
          kind: "EFECTIVO",
          amount: "300.00",
          occurredAt: instant("2026-07-01T12:00:00.000Z"),
          createdAt: instant("2026-07-01T12:00:00.000Z"),
          deletedAt: null,
        }],
        pauses: [{
          start: day("2026-07-11"),
          end: day("2026-07-21"),
          createdAt: instant("2026-07-11T10:00:00.000Z"),
          deletedAt: null,
        }],
      })],
    });
    const cup = result.monedas[0]!;
    expect(cup.ingreso_devengado_mes).toBe("210.00");
    expect(cup.saldo_servicio_pendiente).toBe("90.00");
    expect(cup.membresias[0]?.dias_servicio_mes).toBe(21);
    expect(result.estado_periodo).toBe("PROVISIONAL");
  });

  test("una cancelación respeta el valor no consumido persistido y ajusta el centavo", () => {
    const result = buildMembershipRevenueReport({
      month: "2026-07",
      currentBusinessDate: day("2026-07-31"),
      memberships: [membership({
        price: "100.00",
        durationDays: 3,
        start: day("2026-07-01"),
        endExclusive: day("2026-07-02"),
        state: "CANCELADA",
        funding: [{
          kind: "EFECTIVO",
          amount: "100.00",
          occurredAt: instant("2026-07-01T12:00:00.000Z"),
          createdAt: instant("2026-07-01T12:00:00.000Z"),
          deletedAt: null,
        }],
        adjustments: [{
          type: "CREDITO_CLIENTE",
          effectiveDate: day("2026-07-02"),
          unusedAmount: "66.67",
          createdAt: instant("2026-07-02T15:00:00.000Z"),
          deletedAt: null,
        }],
      })],
    });
    const cup = result.monedas[0]!;
    expect(cup.ingreso_devengado_mes).toBe("33.33");
    expect(cup.ajuste_cancelacion_mes).toBe("-0.01");
    expect(cup.valor_no_consumido_reclasificado).toBe("66.67");
    expect(cup.saldo_servicio_pendiente).toBe("0.00");
  });

  test("reconstruye el mes anterior a un reverso y deja de reconocer después", () => {
    const reversed = membership({
      price: "30.00",
      durationDays: 3,
      start: day("2026-07-01"),
      endExclusive: day("2026-07-04"),
      state: "PENDIENTE_PAGO",
      funding: [{
        kind: "EFECTIVO",
        amount: "30.00",
        occurredAt: instant("2026-07-01T12:00:00.000Z"),
        createdAt: instant("2026-07-01T12:00:00.000Z"),
        deletedAt: instant("2026-08-05T12:00:00.000Z"),
      }],
    });
    const july = buildMembershipRevenueReport({
      month: "2026-07",
      currentBusinessDate: day("2026-08-31"),
      memberships: [reversed],
    });
    const august = buildMembershipRevenueReport({
      month: "2026-08",
      currentBusinessDate: day("2026-08-31"),
      memberships: [reversed],
    });
    expect(july.monedas[0]?.ingreso_devengado_mes).toBe("30.00");
    expect(august.monedas[0]?.ingreso_devengado_mes).toBe("0.00");
    expect(august.cobertura.sin_evidencia_financiera).toBe(1);
  });

  test("no inventa ingreso para una membresía reconstruida sin aplicación", () => {
    const result = buildMembershipRevenueReport({
      month: "2026-07",
      currentBusinessDate: day("2026-07-31"),
      memberships: [membership({
        reconstructed: true,
        funding: [],
      })],
    });
    expect(result.monedas[0]?.ingreso_devengado_mes).toBe("0.00");
    expect(result.cobertura.sin_evidencia_financiera).toBe(1);
    expect(result.monedas[0]?.membresias[0]?.explicacion).toContain("reconstruida");
  });

  test("conserva importes exactos mayores que Number.MAX_SAFE_INTEGER", () => {
    const result = buildMembershipRevenueReport({
      month: "2026-07",
      currentBusinessDate: day("2026-07-01"),
      memberships: [membership({
        price: "9007199254740993.10",
        durationDays: 1,
        start: day("2026-07-01"),
        endExclusive: day("2026-07-02"),
        funding: [{
          kind: "CREDITO",
          amount: "9007199254740993.10",
          occurredAt: instant("2026-07-01T08:00:00.000Z"),
          createdAt: instant("2026-07-01T08:00:00.000Z"),
          deletedAt: null,
        }],
      })],
    });
    expect(result.monedas[0]?.ingreso_devengado_mes)
      .toBe("9007199254740993.10");
  });

  test("aísla una membresía inválida sin ocultar el resto del informe", () => {
    const invalid = membership({
      membershipId: "membership-invalid",
      clientName: "Cliente por revisar",
      endExclusive: instant("2026-04-01T06:00:00.000Z"),
    });
    const result = buildMembershipRevenueReport({
      month: "2026-01",
      currentBusinessDate: day("2026-04-10"),
      memberships: [membership(), invalid],
    });

    expect(result.monedas[0]?.ingreso_devengado_mes).toBe("310.00");
    expect(result.cobertura.membresias_evaluadas).toBe(2);
    expect(result.cobertura.requieren_revision).toBe(1);
    expect(result.monedas[0]?.membresias)
      .toContainEqual(expect.objectContaining({
        membresia_id: "membership-invalid",
        cobertura_estado: "DATOS_CONTRACTUALES_INVALIDOS",
        devengado_mes: "0.00",
        requiere_revision: true,
      }));
  });

  test("calcula fechas heredadas ya normalizadas y conserva la advertencia", () => {
    const result = buildMembershipRevenueReport({
      month: "2026-07",
      currentBusinessDate: day("2026-07-01"),
      memberships: [membership({
        price: "30.00",
        durationDays: 3,
        start: day("2026-07-01"),
        endExclusive: day("2026-07-04"),
        normalizedLegacyCalendarDates: true,
        funding: [{
          kind: "EFECTIVO",
          amount: "30.00",
          occurredAt: instant("2026-07-01T12:00:00.000Z"),
          createdAt: instant("2026-07-01T12:00:00.000Z"),
          deletedAt: null,
        }],
      })],
    });

    expect(result.monedas[0]?.ingreso_devengado_mes).toBe("10.00");
    expect(result.cobertura.requieren_revision).toBe(1);
    expect(result.monedas[0]?.membresias[0]?.explicacion)
      .toContain("fechas heredadas");
  });
});
