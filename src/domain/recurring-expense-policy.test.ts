import { describe, expect, test } from "bun:test";
import {
  planRecurringExpenseGeneration,
  RecurringExpensePolicyError,
  type RecurringExpenseTemplateSnapshot,
} from "./recurring-expense-policy";

const template = (
  overrides: Partial<RecurringExpenseTemplateSnapshot> = {},
): RecurringExpenseTemplateSnapshot => ({
  templateId: overrides.templateId ?? "rec-alquiler",
  categoryId: overrides.categoryId ?? "cat-alquiler",
  categoryName: overrides.categoryName ?? "Alquiler",
  supplierId: overrides.supplierId ?? "prov-1",
  supplierName: overrides.supplierName ?? "Inmobiliaria Centro",
  currencyId: overrides.currencyId ?? "cup",
  currencyCode: overrides.currencyCode ?? "CUP",
  description: overrides.description ?? "Alquiler del local",
  amount: overrides.amount ?? "1800.00",
  scheduledDay: overrides.scheduledDay ?? 5,
  startMonth: overrides.startMonth ?? "2026-01",
  endMonth: overrides.endMonth ?? null,
  active: overrides.active ?? true,
  notes: overrides.notes ?? null,
});

const BUSINESS_DAY = new Date("2026-07-21T00:00:00.000Z");

describe("recurring expense policy", () => {
  test("planifica la generación del mes en curso", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-07",
      currentBusinessDate: BUSINESS_DAY,
      templates: [template()],
      generated: [],
    });

    expect(plan.estado_periodo).toBe("EN_CURSO");
    expect(plan.puede_generar).toBe(true);
    expect(plan.a_generar).toHaveLength(1);
    expect(plan.a_generar[0].mes_pertenencia).toBe("2026-07");
    expect(plan.a_generar[0].fecha_programada).toBe("2026-07-05");
    expect(plan.totales_por_moneda[0].importe).toBe("1800.00");
  });

  test("no genera un mes futuro", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-09",
      currentBusinessDate: BUSINESS_DAY,
      templates: [template()],
      generated: [],
    });

    expect(plan.estado_periodo).toBe("FUTURO");
    expect(plan.puede_generar).toBe(false);
    expect(plan.motivo_bloqueo).toContain("todavía no ocurrió");
    // La plantilla igual se muestra: el operador debe ver qué se generaría.
    expect(plan.a_generar).toHaveLength(1);
  });

  test("un mes pasado sí se puede generar, por si se olvidó", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-05",
      currentBusinessDate: BUSINESS_DAY,
      templates: [template()],
      generated: [],
    });

    expect(plan.estado_periodo).toBe("HISTORICO");
    expect(plan.puede_generar).toBe(true);
  });

  test("generar dos veces el mismo mes no duplica", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-07",
      currentBusinessDate: BUSINESS_DAY,
      templates: [template()],
      generated: [
        { templateId: "rec-alquiler", month: "2026-07", expenseId: "gasto-1" },
      ],
    });

    expect(plan.a_generar).toHaveLength(0);
    expect(plan.puede_generar).toBe(false);
    expect(plan.omitidas[0].motivo).toBe("YA_GENERADO");
    expect(plan.omitidas[0].gasto_id).toBe("gasto-1");
    expect(plan.resumen.ya_generadas).toBe(1);
  });

  test("un gasto generado para otro mes no bloquea este", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-07",
      currentBusinessDate: BUSINESS_DAY,
      templates: [template()],
      generated: [
        { templateId: "rec-alquiler", month: "2026-06", expenseId: "gasto-junio" },
      ],
    });

    expect(plan.a_generar).toHaveLength(1);
  });

  test("respeta desactivación y vigencia con su motivo", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-07",
      currentBusinessDate: BUSINESS_DAY,
      templates: [
        template({ templateId: "inactiva", description: "Limpieza", active: false }),
        template({
          templateId: "futura",
          description: "Seguro nuevo",
          startMonth: "2026-10",
        }),
        template({
          templateId: "terminada",
          description: "Alquiler viejo local",
          endMonth: "2026-04",
        }),
        template({ templateId: "vigente", description: "Electricidad" }),
      ],
      generated: [],
    });

    expect(plan.a_generar.map((row: any) => row.recurrente_id)).toEqual([
      "vigente",
    ]);
    const reasons = Object.fromEntries(
      plan.omitidas.map((row: any) => [row.recurrente_id, row.motivo]),
    );
    expect(reasons).toEqual({
      inactiva: "INACTIVA",
      futura: "ANTES_DE_VIGENCIA",
      terminada: "DESPUES_DE_VIGENCIA",
    });
  });

  test("la vigencia incluye el mes de término", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-07",
      currentBusinessDate: BUSINESS_DAY,
      templates: [template({ endMonth: "2026-07" })],
      generated: [],
    });

    expect(plan.a_generar).toHaveLength(1);
  });

  test("no mezcla monedas en los totales", () => {
    const plan = planRecurringExpenseGeneration({
      month: "2026-07",
      currentBusinessDate: BUSINESS_DAY,
      templates: [
        template(),
        template({
          templateId: "rec-software",
          description: "Software de gestión",
          currencyId: "eur",
          currencyCode: "EUR",
          amount: "25.00",
        }),
      ],
      generated: [],
    });

    expect(plan.totales_por_moneda).toEqual([
      { moneda_id: "cup", moneda_codigo: "CUP", importe: "1800.00" },
      { moneda_id: "eur", moneda_codigo: "EUR", importe: "25.00" },
    ]);
  });

  test("rechaza un día programado que no existe en todos los meses", () => {
    expect(() =>
      planRecurringExpenseGeneration({
        month: "2026-07",
        currentBusinessDate: BUSINESS_DAY,
        templates: [template({ scheduledDay: 31 })],
        generated: [],
      })
    ).toThrow(RecurringExpensePolicyError);
  });

  test("rechaza una plantilla que termina antes de empezar", () => {
    expect(() =>
      planRecurringExpenseGeneration({
        month: "2026-07",
        currentBusinessDate: BUSINESS_DAY,
        templates: [template({ startMonth: "2026-06", endMonth: "2026-03" })],
        generated: [],
      })
    ).toThrow(/termina antes de empezar/);
  });

  test("rechaza un importe no positivo", () => {
    expect(() =>
      planRecurringExpenseGeneration({
        month: "2026-07",
        currentBusinessDate: BUSINESS_DAY,
        templates: [template({ amount: "0.00" })],
        generated: [],
      })
    ).toThrow(/importe positivo/);
  });
});
