import { describe, expect, test } from "bun:test";
import {
  buildCommissionSchedule,
  compensationProfileStatusAt,
  compensationProfilesOverlap,
  normalizeCompensationProfileDraft,
} from "./compensation-profile-policy";

describe("compensation profile policy", () => {
  test("valida modalidad, frecuencia, corte e importe fijo", () => {
    const draft = normalizeCompensationProfileDraft({
      id_entrenador: " trainer-1 ",
      modalidad: "mixto",
      metodo_devengo: "dias_servicio",
      frecuencia_desembolso: "quincenal",
      dia_corte: 15,
      monto_fijo: "125.50",
      moneda_id: "currency-1",
      fecha_inicio: "2026-07-01T00:00:00.000Z",
    }, new Date("2026-07-14T12:00:00.000Z"));
    expect(draft).toMatchObject({
      trainerId: "trainer-1",
      modality: "MIXTO",
      earningMethod: "DIAS_SERVICIO",
      payoutFrequency: "QUINCENAL",
      cutoffDay: 15,
      fixedAmount: "125.50",
    });
    expect(() => normalizeCompensationProfileDraft({
      id_entrenador: "trainer-1",
      modalidad: "FIJO",
      frecuencia_desembolso: "MENSUAL",
      dia_corte: 31,
      monto_fijo: 100,
      moneda_id: "currency-1",
    }, new Date())).toThrow("1 y 28");
  });

  test("mantiene vigencias semiabiertas por entrenador", () => {
    const first = {
      trainerId: "trainer-1",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-04-01T00:00:00.000Z"),
    };
    const next = {
      trainerId: "trainer-1",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: null,
    };
    expect(compensationProfilesOverlap(first, next)).toBe(false);
    expect(compensationProfilesOverlap(first, {
      ...next,
      startDate: new Date("2026-03-31T00:00:00.000Z"),
    })).toBe(true);
    expect(compensationProfilesOverlap(first, {
      ...next,
      trainerId: "trainer-2",
      startDate: new Date("2026-03-31T00:00:00.000Z"),
    })).toBe(false);
  });

  test("clasifica el perfil usando el día comercial UTC canónico", () => {
    const base = {
      trainerId: "trainer-1",
      startDate: new Date("2026-07-14T00:00:00.000Z"),
      endDate: null,
    };
    expect(compensationProfileStatusAt(base, new Date("2026-07-14T20:00:00.000Z")))
      .toBe("VIGENTE");
    expect(compensationProfileStatusAt({
      ...base,
      startDate: new Date("2026-07-15T00:00:00.000Z"),
    }, new Date("2026-07-14T20:00:00.000Z"))).toBe("PROGRAMADO");
  });

  test("los periodos iguales conservan total y alinean el desembolso", () => {
    const schedule = buildCommissionSchedule({
      totalAmount: "750.00",
      serviceStart: new Date("2026-01-31T00:00:00.000Z"),
      serviceEnd: new Date("2026-04-30T00:00:00.000Z"),
      earningMethod: "PERIODOS_IGUALES",
      payoutFrequency: "MENSUAL",
      cutoffDay: 28,
    });
    expect(schedule).toHaveLength(3);
    expect(schedule.map((item) => item.amount)).toEqual(["250.00", "250.00", "250.00"]);
    expect(schedule[0].periodEnd.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(schedule[0].payableDate.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  test("el devengo diario se agrupa por fecha de desembolso sin perder centavos", () => {
    const schedule = buildCommissionSchedule({
      totalAmount: "100.00",
      serviceStart: new Date("2026-07-01T00:00:00.000Z"),
      serviceEnd: new Date("2026-07-11T00:00:00.000Z"),
      earningMethod: "DIAS_SERVICIO",
      payoutFrequency: "SEMANAL",
      cutoffDay: 5,
    });
    const total = schedule.reduce((sum, item) => sum + Number(item.amount), 0);
    expect(total).toBe(100);
    expect(schedule.length).toBeGreaterThan(1);
    expect(schedule.every((item) => {
      const day = item.payableDate.getUTCDay();
      return day === 5;
    })).toBe(true);
  });
});


