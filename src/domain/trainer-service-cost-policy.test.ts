import { describe, expect, test } from "bun:test";
import {
  buildTrainerServiceCostReport,
  type TrainerServiceCostSnapshot,
} from "./trainer-service-cost-policy";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const instant = (value: string) => new Date(value);

function cost(overrides: Partial<TrainerServiceCostSnapshot> = {}): TrainerServiceCostSnapshot {
  return {
    costId: "cost-1",
    groupId: "accrual-1",
    source: "COMISION",
    trainerId: "trainer-1",
    trainerName: "Ana Fuerza",
    membershipId: "membership-1",
    clientId: "CI-1",
    clientName: "Cliente Uno",
    planId: "plan-1",
    planName: "Plan trimestral",
    currencyId: "currency-cup",
    currencyCode: "CUP",
    total: "100.00",
    earningMethod: "DIAS_SERVICIO",
    periodStart: date("2026-07-01"),
    periodEnd: date("2026-07-04"),
    scheduledDate: date("2026-07-05"),
    state: "PENDIENTE",
    createdAt: instant("2026-07-01T12:00:00.000Z"),
    updatedAt: instant("2026-07-01T12:00:00.000Z"),
    applications: [],
    pauses: [],
    ...overrides,
  };
}

function report(costs: TrainerServiceCostSnapshot[], month = "2026-07") {
  return buildTrainerServiceCostReport({
    month,
    currentBusinessDate: date("2026-07-18"),
    costs,
  });
}

describe("trainer service cost policy", () => {
  test("prorratea DIAS_SERVICIO sin perder centavos", () => {
    const result = report([cost({ total: "1.00" })]);
    const row = result.monedas[0].costos[0];
    expect(row.costo_devengado_mes).toBe("1.00");
    expect(row.dias_servicio_acumulados).toBe(3);
    expect(row.ganado_pendiente_pago).toBe("1.00");
  });

  test("PERIODOS_IGUALES gana la cuota al completar el periodo", () => {
    const result = report([cost({
      earningMethod: "PERIODOS_IGUALES",
      periodEnd: date("2026-08-01"),
    })]);
    expect(result.monedas[0].costos[0].costo_devengado_mes).toBe("0.00");
    expect(result.monedas[0].costos[0].costo_futuro_comprometido).toBe("100.00");
  });

  test("una pausa desplaza secuencialmente las cuotas sin solaparlas", () => {
    const pause = {
      start: date("2026-07-15"),
      end: date("2026-07-20"),
      createdAt: instant("2026-07-15T12:00:00.000Z"),
      deletedAt: null,
    };
    const first = cost({
      costId: "cost-1",
      total: "31.00",
      periodStart: date("2026-07-01"),
      periodEnd: date("2026-08-01"),
      pauses: [pause],
    });
    const second = cost({
      costId: "cost-2",
      total: "31.00",
      periodStart: date("2026-08-01"),
      periodEnd: date("2026-09-01"),
      pauses: [pause],
    });
    const result = buildTrainerServiceCostReport({
      month: "2026-08",
      currentBusinessDate: date("2026-08-05"),
      costs: [first, second],
    });
    expect(result.monedas[0].costos[0].costo_devengado_acumulado).toBe("31.00");
    expect(result.monedas[0].costos[1].costo_devengado_acumulado).toBe("0.00");
  });

  test("una reasignación conserva cada tramo con su entrenador", () => {
    const result = report([
      cost({ costId: "old", trainerId: "trainer-old", trainerName: "Ana" }),
      cost({
        costId: "new",
        groupId: "accrual-2",
        trainerId: "trainer-new",
        trainerName: "Leo",
      }),
    ]);
    expect(result.monedas[0].entrenadores.map((row) => row.entrenador_nombre))
      .toEqual(["Ana", "Leo"]);
  });

  test("separa lo ganado, pagado y pendiente", () => {
    const result = report([cost({
      applications: [{
        amount: "0.40",
        state: "APLICADA",
        createdAt: instant("2026-07-05T12:00:00.000Z"),
        updatedAt: instant("2026-07-05T12:00:00.000Z"),
      }],
      total: "1.00",
    })]);
    const currency = result.monedas[0];
    expect(currency.costo_devengado_acumulado).toBe("1.00");
    expect(currency.pagado_acumulado).toBe("0.40");
    expect(currency.ganado_pendiente_pago).toBe("0.60");
  });

  test("no mezcla monedas y deja el fijo sin atribución inventada", () => {
    const result = report([
      cost(),
      cost({
        costId: "fixed-1",
        groupId: "fixed-1",
        source: "FIJO",
        membershipId: null,
        clientId: null,
        clientName: null,
        planId: null,
        planName: null,
        currencyId: "currency-eur",
        currencyCode: "EUR",
      }),
    ]);
    expect(result.monedas.map((row) => row.moneda_codigo)).toEqual(["CUP", "EUR"]);
    expect(result.monedas[1].costos[0].atribucion).toBe("FIJO_NO_DISTRIBUIDO");
    expect(result.monedas[1].costos[0].requiere_revision).toBeFalse();
  });

  test("aísla un concepto inválido y conserva el resto del informe", () => {
    const result = report([
      cost({ costId: "bad", total: "-1.00" }),
      cost({ costId: "good", groupId: "good" }),
    ]);
    expect(result.cobertura.conceptos_evaluados).toBe(2);
    expect(result.cobertura.requieren_revision).toBe(1);
    expect(result.monedas[0].costo_devengado_acumulado).toBe("100.00");
  });
});

