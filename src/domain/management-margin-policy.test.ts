import { describe, expect, test } from "bun:test";
import { buildManagementMarginReport } from "./management-margin-policy";
import { buildMembershipRevenueReport, type MembershipRevenueSnapshot } from "./membership-revenue-policy";
import {
  buildTrainerServiceCostReport,
  type TrainerServiceCostSnapshot,
} from "./trainer-service-cost-policy";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const instant = (value: string) => new Date(value);

function membership(
  overrides: Partial<MembershipRevenueSnapshot> = {},
): MembershipRevenueSnapshot {
  return {
    membershipId: "membership-1",
    clientId: "CI-1",
    clientName: "Cliente Uno",
    planId: "plan-1",
    planName: "Plan mensual",
    currencyId: "currency-cup",
    currencyCode: "CUP",
    price: "100.00",
    durationDays: 10,
    start: date("2026-07-01"),
    endExclusive: date("2026-07-11"),
    state: "ACTIVA",
    origin: "LOCAL",
    reconstructed: false,
    createdAt: instant("2026-07-01T12:00:00.000Z"),
    funding: [{
      kind: "EFECTIVO",
      amount: "100.00",
      occurredAt: instant("2026-07-01T12:00:00.000Z"),
      createdAt: instant("2026-07-01T12:00:00.000Z"),
      deletedAt: null,
    }],
    pauses: [],
    adjustments: [],
    ...overrides,
  };
}

function cost(
  overrides: Partial<TrainerServiceCostSnapshot> = {},
): TrainerServiceCostSnapshot {
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
    planName: "Plan mensual",
    currencyId: "currency-cup",
    currencyCode: "CUP",
    total: "20.00",
    earningMethod: "DIAS_SERVICIO",
    periodStart: date("2026-07-01"),
    periodEnd: date("2026-07-11"),
    scheduledDate: date("2026-07-11"),
    state: "PENDIENTE",
    createdAt: instant("2026-07-01T12:00:00.000Z"),
    updatedAt: instant("2026-07-01T12:00:00.000Z"),
    applications: [],
    pauses: [],
    ...overrides,
  };
}

function report(
  memberships: MembershipRevenueSnapshot[],
  costs: TrainerServiceCostSnapshot[],
  month = "2026-07",
) {
  return buildManagementMarginReport({
    month,
    currentBusinessDate: date("2026-07-18"),
    memberships,
    costs,
  });
}

describe("management margin policy", () => {
  test("resta el costo directo del ingreso ya ganado", () => {
    const result = report([membership()], [cost()]);
    const currency = result.monedas[0];
    expect(currency.ingreso_devengado_acumulado).toBe("100.00");
    expect(currency.costo_directo_acumulado).toBe("20.00");
    expect(currency.margen_directo_acumulado).toBe("80.00");
    expect(currency.margen_directo_pct_acumulado).toBe("80.0");
    expect(result.cobertura.completa).toBe(true);
  });

  test("coincide por construcción con los reportes R4.1 y R4.2", () => {
    const memberships = [
      membership(),
      membership({ membershipId: "membership-2", clientId: "CI-2", clientName: "Cliente Dos" }),
    ];
    const costs = [cost(), cost({ costId: "cost-2", groupId: "accrual-2", source: "FIJO", membershipId: null, clientId: null, clientName: null, planId: null, planName: null, total: "50.00" })];
    const revenue = buildMembershipRevenueReport({
      month: "2026-07",
      currentBusinessDate: date("2026-07-18"),
      memberships,
    });
    const serviceCost = buildTrainerServiceCostReport({
      month: "2026-07",
      currentBusinessDate: date("2026-07-18"),
      costs,
    });
    const margin = report(memberships, costs);
    expect(margin.monedas[0].ingreso_devengado_acumulado)
      .toBe(revenue.monedas[0].ingreso_devengado_acumulado);
    const commissionTotal = serviceCost.monedas[0].costos
      .filter((row) => row.fuente === "COMISION")
      .reduce((total, row) => total + Number(row.costo_devengado_acumulado), 0);
    expect(Number(margin.monedas[0].costo_directo_acumulado)).toBe(commissionTotal);
  });

  test("el fijo queda separado y solo se resta en el total por moneda", () => {
    const result = report([membership()], [
      cost(),
      cost({
        costId: "fixed-1",
        groupId: "accrual-fixed",
        source: "FIJO",
        membershipId: null,
        clientId: null,
        clientName: null,
        planId: null,
        planName: null,
        total: "10.00",
      }),
    ]);
    const currency = result.monedas[0];
    expect(currency.costo_directo_acumulado).toBe("20.00");
    expect(currency.fijo_no_distribuido_acumulado).toBe("10.00");
    expect(currency.margen_directo_acumulado).toBe("80.00");
    expect(currency.margen_menos_fijo_acumulado).toBe("70.00");
    expect(currency.planes).toHaveLength(1);
    expect(currency.planes[0].costo_directo_acumulado).toBe("20.00");
    const trainer = currency.entrenadores[0];
    expect(trainer.fijo_no_distribuido_acumulado).toBe("10.00");
    expect(trainer.margen_directo_acumulado).toBe("80.00");
  });

  test("agrupa margen por plan y por cliente", () => {
    const result = report(
      [
        membership(),
        membership({
          membershipId: "membership-2",
          clientId: "CI-2",
          clientName: "Cliente Dos",
          planId: "plan-2",
          planName: "Plan trimestral",
          price: "40.00",
        }),
      ],
      [
        cost(),
        cost({
          costId: "cost-2",
          groupId: "accrual-2",
          membershipId: "membership-2",
          clientId: "CI-2",
          clientName: "Cliente Dos",
          planId: "plan-2",
          planName: "Plan trimestral",
          total: "30.00",
        }),
      ],
    );
    const currency = result.monedas[0];
    const monthly = currency.planes.find((row) => row.plan_id === "plan-1");
    const quarterly = currency.planes.find((row) => row.plan_id === "plan-2");
    expect(monthly?.margen_directo_acumulado).toBe("80.00");
    expect(quarterly?.margen_directo_acumulado).toBe("10.00");
    const clientTwo = currency.clientes.find((row) => row.ci === "CI-2");
    expect(clientTwo?.margen_directo_acumulado).toBe("10.00");
    expect(currency.planes[0].plan_id).toBe("plan-1");
  });

  test("presenta un margen negativo con signo y porcentaje negativo", () => {
    const result = report([membership()], [cost({ total: "150.00" })]);
    const currency = result.monedas[0];
    expect(currency.margen_directo_acumulado).toBe("-50.00");
    expect(currency.margen_directo_pct_acumulado).toBe("-50.0");
  });

  test("una membresía con dos entrenadores no reparte el ingreso", () => {
    const result = report([membership()], [
      cost({ costId: "old", trainerId: "trainer-old", trainerName: "Ana" }),
      cost({
        costId: "new",
        groupId: "accrual-2",
        trainerId: "trainer-new",
        trainerName: "Leo",
      }),
    ]);
    const currency = result.monedas[0];
    expect(currency.atribucion.membresias_compartidas).toBe(1);
    expect(currency.atribucion.ingreso_compartido_acumulado).toBe("100.00");
    for (const trainer of currency.entrenadores) {
      expect(trainer.ingreso_devengado_acumulado).toBe("0.00");
      expect(trainer.membresias_compartidas).toBe(1);
      expect(trainer.atribucion_completa).toBe(false);
    }
    expect(result.cobertura.membresias_compartidas).toBe(1);
    expect(result.cobertura.completa).toBe(true);
  });

  test("una membresía sin entrenador conserva su ingreso en el bloque propio", () => {
    const result = report([membership()], []);
    const currency = result.monedas[0];
    expect(currency.atribucion.membresias_sin_entrenador).toBe(1);
    expect(currency.atribucion.ingreso_sin_entrenador_acumulado).toBe("100.00");
    expect(currency.entrenadores).toHaveLength(0);
    expect(currency.margen_directo_acumulado).toBe("100.00");
  });

  test("un costo sin ingreso verificable exige revisión y no se pierde", () => {
    const result = report([], [cost({ membershipId: "membership-x" })]);
    const currency = result.monedas[0];
    expect(currency.atribucion.conceptos_costo_sin_ingreso).toBe(1);
    expect(currency.atribucion.costo_sin_ingreso_acumulado).toBe("20.00");
    expect(currency.margen_directo_acumulado).toBe("-20.00");
    expect(currency.entrenadores[0].costo_sin_ingreso_acumulado).toBe("20.00");
    expect(currency.entrenadores[0].atribucion_completa).toBe(false);
    expect(result.cobertura.completa).toBe(false);
  });

  test("no mezcla monedas distintas", () => {
    const result = report(
      [
        membership(),
        membership({
          membershipId: "membership-usd",
          currencyId: "currency-usd",
          currencyCode: "USD",
        }),
      ],
      [cost()],
    );
    expect(result.monedas.map((row) => row.moneda_codigo)).toEqual([
      "CUP",
      "USD",
    ]);
    const usd = result.monedas.find((row) => row.moneda_codigo === "USD");
    expect(usd?.costo_directo_acumulado).toBe("0.00");
    expect(usd?.margen_directo_acumulado).toBe("100.00");
  });

  test("rechaza un mes con formato inválido", () => {
    expect(() =>
      buildManagementMarginReport({
        month: "07-2026",
        currentBusinessDate: date("2026-07-18"),
        memberships: [],
        costs: [],
      })
    ).toThrow("El mes debe usar el formato AAAA-MM.");
  });

  test("conserva estado del periodo y fecha de corte del mes provisional", () => {
    const result = report([membership()], [cost()]);
    expect(result.estado_periodo).toBe("PROVISIONAL");
    expect(result.fecha_corte).toBe("2026-07-18");
    expect(result.naturaleza).toBe("MARGEN_GERENCIAL");
  });
});
