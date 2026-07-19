import { describe, expect, test } from "bun:test";
import {
  buildInstallmentSchedule,
  classifyInstallmentOverdue,
  isMembershipAccessBlocked,
  PlanInstallmentPolicyError,
  type InstallmentSchemeInput,
} from "./plan-installment-policy";

const start = new Date("2026-07-01T00:00:00.000Z");

describe("plan installment policy — buildInstallmentSchedule", () => {
  test("construye un esquema trimestral asimétrico 15+10 sobre 90 días", () => {
    // Plan trimestral (90 días) a 25.00: cuota 1 = 15.00 (mes 1, 30 días),
    // cuota 2 = 10.00 (meses 2-3, 60 días).
    const scheme: InstallmentSchemeInput[] = [
      { numeroCuota: 1, importe: "15.00", diasCobertura: 30 },
      { numeroCuota: 2, importe: "10.00", diasCobertura: 60 },
    ];
    const schedule = buildInstallmentSchedule({
      planPrice: "25.00",
      planDurationDays: 90,
      membershipStart: start,
      scheme,
    });

    expect(schedule).toHaveLength(2);
    expect(schedule[0].numeroCuota).toBe(1);
    expect(schedule[0].importe).toBe("15.00");
    expect(schedule[0].diasCobertura).toBe(30);
    expect(schedule[0].fechaCoberturaInicio.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(schedule[0].fechaCoberturaFinExclusive.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(schedule[1].fechaCoberturaInicio.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(schedule[1].fechaCoberturaFinExclusive.toISOString()).toBe("2026-09-29T00:00:00.000Z");
  });

  test("la fecha exigible de cada cuota es el inicio de su tramo", () => {
    const schedule = buildInstallmentSchedule({
      planPrice: "25.00",
      planDurationDays: 90,
      membershipStart: start,
      scheme: [
        { numeroCuota: 1, importe: "15.00", diasCobertura: 30 },
        { numeroCuota: 2, importe: "10.00", diasCobertura: 60 },
      ],
    });
    expect(schedule[0].fechaExigible.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(schedule[1].fechaExigible.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  test("rechaza si la suma de días de cobertura no coincide con la duración", () => {
    expect(() =>
      buildInstallmentSchedule({
        planPrice: "25.00",
        planDurationDays: 90,
        membershipStart: start,
        scheme: [
          { numeroCuota: 1, importe: "15.00", diasCobertura: 30 },
          { numeroCuota: 2, importe: "10.00", diasCobertura: 55 },
        ],
      }),
    ).toThrow(PlanInstallmentPolicyError);
  });

  test("rechaza si la suma de importes no coincide con el precio", () => {
    expect(() =>
      buildInstallmentSchedule({
        planPrice: "25.00",
        planDurationDays: 90,
        membershipStart: start,
        scheme: [
          { numeroCuota: 1, importe: "15.00", diasCobertura: 30 },
          { numeroCuota: 2, importe: "8.00", diasCobertura: 60 },
        ],
      }),
    ).toThrow(PlanInstallmentPolicyError);
  });

  test("rechaza cuotas no secuenciales desde 1", () => {
    expect(() =>
      buildInstallmentSchedule({
        planPrice: "25.00",
        planDurationDays: 90,
        membershipStart: start,
        scheme: [
          { numeroCuota: 1, importe: "15.00", diasCobertura: 30 },
          { numeroCuota: 3, importe: "10.00", diasCobertura: 60 },
        ],
      }),
    ).toThrow(PlanInstallmentPolicyError);
  });

  test("rechaza un esquema vacío", () => {
    expect(() =>
      buildInstallmentSchedule({
        planPrice: "25.00",
        planDurationDays: 90,
        membershipStart: start,
        scheme: [],
      }),
    ).toThrow(PlanInstallmentPolicyError);
  });

  test("rechaza días de cobertura no positivos", () => {
    expect(() =>
      buildInstallmentSchedule({
        planPrice: "25.00",
        planDurationDays: 90,
        membershipStart: start,
        scheme: [
          { numeroCuota: 1, importe: "15.00", diasCobertura: 0 },
          { numeroCuota: 2, importe: "10.00", diasCobertura: 90 },
        ],
      }),
    ).toThrow(PlanInstallmentPolicyError);
  });
});

describe("plan installment policy — classifyInstallmentOverdue", () => {
  const cuota1 = {
    estado: "PENDIENTE",
    fechaCoberturaInicio: new Date("2026-07-01T00:00:00.000Z"),
    fechaCoberturaFinExclusive: new Date("2026-07-31T00:00:00.000Z"),
  };

  test("cuota pagada siempre está AL_DIA", () => {
    const state = classifyInstallmentOverdue({
      cuota: { ...cuota1, estado: "PAGADA" },
      businessDate: new Date("2026-07-15T00:00:00.000Z"),
      graceDays: 0,
    });
    expect(state).toBe("AL_DIA");
  });

  test("antes del tramo la cuota está VIGENTE", () => {
    const state = classifyInstallmentOverdue({
      cuota: cuota1,
      businessDate: new Date("2026-06-15T00:00:00.000Z"),
      graceDays: 0,
    });
    expect(state).toBe("VIGENTE");
  });

  test("tramo empezado sin gracia es MOROSA", () => {
    const state = classifyInstallmentOverdue({
      cuota: cuota1,
      businessDate: new Date("2026-07-02T00:00:00.000Z"),
      graceDays: 0,
    });
    expect(state).toBe("MOROSA");
  });

  test("tramo empezado con gracia >0 está VENCIDA_EN_GRACIA dentro de la gracia", () => {
    const state = classifyInstallmentOverdue({
      cuota: cuota1,
      businessDate: new Date("2026-07-02T00:00:00.000Z"),
      graceDays: 2,
    });
    expect(state).toBe("VENCIDA_EN_GRACIA");
  });

  test("tramo empezado con gracia agotada es MOROSA", () => {
    const state = classifyInstallmentOverdue({
      cuota: cuota1,
      businessDate: new Date("2026-07-04T00:00:00.000Z"),
      graceDays: 2,
    });
    expect(state).toBe("MOROSA");
  });
});

describe("plan installment policy — isMembershipAccessBlocked", () => {
  const cuotas = [
    {
      numeroCuota: 1,
      estado: "PAGADA",
      fechaCoberturaInicio: new Date("2026-07-01T00:00:00.000Z"),
      fechaCoberturaFinExclusive: new Date("2026-07-31T00:00:00.000Z"),
    },
    {
      numeroCuota: 2,
      estado: "PENDIENTE",
      fechaCoberturaInicio: new Date("2026-07-31T00:00:00.000Z"),
      fechaCoberturaFinExclusive: new Date("2026-09-29T00:00:00.000Z"),
    },
  ];

  test("permite el acceso cuando la cuota vigente está pagada", () => {
    const result = isMembershipAccessBlocked({
      cuotas,
      businessDate: new Date("2026-07-15T00:00:00.000Z"),
      graceDays: 0,
    });
    expect(result.blocked).toBe(false);
  });

  test("bloquea el acceso cuando la cuota vigente está morosa", () => {
    const result = isMembershipAccessBlocked({
      cuotas,
      businessDate: new Date("2026-08-01T00:00:00.000Z"),
      graceDays: 0,
    });
    expect(result.blocked).toBe(true);
    expect(result.blockingCuota).toBe(2);
    expect(result.reason).toContain("Cuota 2");
  });

  test("permite el acceso durante la gracia aunque la cuota esté pendiente", () => {
    const result = isMembershipAccessBlocked({
      cuotas,
      businessDate: new Date("2026-08-01T00:00:00.000Z"),
      graceDays: 3,
    });
    expect(result.blocked).toBe(false);
  });

  test("no bloquea si el día cae fuera de todos los tramos", () => {
    const result = isMembershipAccessBlocked({
      cuotas,
      businessDate: new Date("2026-10-15T00:00:00.000Z"),
      graceDays: 0,
    });
    expect(result.blocked).toBe(false);
  });
});
