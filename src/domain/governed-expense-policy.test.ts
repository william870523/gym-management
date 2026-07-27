import { describe, expect, test } from "bun:test";
import {
  buildGovernedExpenseReport,
  GovernedExpensePolicyError,
  type GovernedExpenseSnapshot,
} from "./governed-expense-policy";

const baseExpense = (
  overrides: Partial<GovernedExpenseSnapshot> = {},
): GovernedExpenseSnapshot => ({
  expenseId: overrides.expenseId ?? "gasto-1",
  categoryId: overrides.categoryId ?? "cat-alquiler",
  categoryName: overrides.categoryName ?? "Alquiler",
  categoryNature: overrides.categoryNature ?? "OPERATIVO",
  supplierId: overrides.supplierId ?? "prov-1",
  supplierName: overrides.supplierName ?? "Inmobiliaria Centro",
  currencyId: overrides.currencyId ?? "cup",
  currencyCode: overrides.currencyCode ?? "CUP",
  description: overrides.description ?? "Alquiler local julio",
  amount: overrides.amount ?? "1500.00",
  belongingMonth: overrides.belongingMonth ?? "2026-07",
  scheduledDate: overrides.scheduledDate ?? new Date("2026-07-05T00:00:00.000Z"),
  paidAt: overrides.paidAt ?? null,
  state: overrides.state ?? "PENDIENTE",
  paidAccumulated: overrides.paidAccumulated ?? "0",
  receiptReference: overrides.receiptReference ?? null,
  registeredByUserId: overrides.registeredByUserId ?? "user-admin",
  createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z"),
  applications: overrides.applications ?? [],
});

describe("governed expense policy", () => {
  test("devenga el gasto que pertenece al mes y separa monedas", () => {
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-alquiler",
          amount: "1500.00",
          currencyId: "cup",
          currencyCode: "CUP",
        }),
        baseExpense({
          expenseId: "gasto-internet",
          amount: "60.00",
          currencyId: "usd",
          currencyCode: "USD",
          categoryName: "Proveedores",
          description: "Internet julio",
        }),
      ],
    });

    expect(result.naturaleza).toBe("GASTO_DEVENGADO_GOBERNADO");
    expect(result.estado_periodo).toBe("PROVISIONAL");
    expect(result.cobertura.gastos_evaluados).toBe(2);
    expect(result.cobertura.gastos_pendientes_pago).toBe(2);
    const cup = result.monedas.find((c) => c.moneda_codigo === "CUP")!;
    const usd = result.monedas.find((c) => c.moneda_codigo === "USD")!;
    expect(cup.devengado_mes).toBe("1500.00");
    expect(cup.pendiente_pago).toBe("1500.00");
    expect(usd.devengado_mes).toBe("60.00");
    expect(result.monedas).toHaveLength(2);
  });

  test("el pago anticipado pertenece al mes pero cuenta como pago anticipado", () => {
    // Alquiler de julio pagado en junio: el gasto se devenga en julio, pero el
    // dinero salió en junio (pago anticipado). No se mezcla con el devengo.
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-anticipado",
          amount: "1500.00",
          paidAt: new Date("2026-06-28T00:00:00.000Z"),
          paidAccumulated: "1500.00",
          state: "PAGADO",
          applications: [{
            amount: "1500.00",
            state: "APLICADA",
            paidAt: new Date("2026-06-28T00:00:00.000Z"),
            createdAt: new Date("2026-06-28T00:00:00.000Z"),
            updatedAt: new Date("2026-06-28T00:00:00.000Z"),
          }],
        }),
      ],
    });

    const cup = result.monedas.find((c) => c.moneda_codigo === "CUP")!;
    expect(cup.devengado_mes).toBe("1500.00");
    expect(cup.pago_anticipado).toBe("1500.00");
    expect(cup.pagado_mes).toBe("0.00");
    expect(cup.pendiente_pago).toBe("0.00");
    expect(result.cobertura.gastos_pendientes_pago).toBe(0);
  });

  test("el pago atrasado sigue perteneciendo al mes y marca pago atrasado", () => {
    // Electricidad de julio pagada en agosto: el devengo sigue siendo de julio,
    // el pago se clasifica como atrasado porque salió después del mes.
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-08-05T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-electricidad",
          amount: "320.50",
          paidAt: new Date("2026-08-03T00:00:00.000Z"),
          paidAccumulated: "320.50",
          state: "PAGADO",
          applications: [{
            amount: "320.50",
            state: "APLICADA",
            paidAt: new Date("2026-08-03T00:00:00.000Z"),
            createdAt: new Date("2026-08-03T00:00:00.000Z"),
            updatedAt: new Date("2026-08-03T00:00:00.000Z"),
          }],
        }),
      ],
    });

    expect(result.estado_periodo).toBe("HISTORICO_RECALCULADO");
    const cup = result.monedas.find((c) => c.moneda_codigo === "CUP")!;
    expect(cup.devengado_mes).toBe("320.50");
    expect(cup.pago_atrasado).toBe("320.50");
    expect(cup.pagado_mes).toBe("0.00");
    expect(cup.pendiente_pago).toBe("0.00");
  });

  test("el pago dentro del mes cuenta como pagado_mes", () => {
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-limpieza",
          amount: "200.00",
          paidAt: new Date("2026-07-10T00:00:00.000Z"),
          paidAccumulated: "200.00",
          state: "PAGADO",
          applications: [{
            amount: "200.00",
            state: "APLICADA",
            paidAt: new Date("2026-07-10T00:00:00.000Z"),
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
            updatedAt: new Date("2026-07-10T00:00:00.000Z"),
          }],
        }),
      ],
    });

    const cup = result.monedas.find((c) => c.moneda_codigo === "CUP")!;
    expect(cup.devengado_mes).toBe("200.00");
    expect(cup.pagado_mes).toBe("200.00");
    expect(cup.pago_anticipado).toBe("0.00");
    expect(cup.pago_atrasado).toBe("0.00");
  });

  test("el pago parcial deja pendiente y marca el estado", () => {
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-mantenimiento",
          amount: "480.00",
          paidAt: new Date("2026-07-12T00:00:00.000Z"),
          paidAccumulated: "180.00",
          state: "PARCIAL",
          applications: [{
            amount: "180.00",
            state: "APLICADA",
            paidAt: new Date("2026-07-12T00:00:00.000Z"),
            createdAt: new Date("2026-07-12T00:00:00.000Z"),
            updatedAt: new Date("2026-07-12T00:00:00.000Z"),
          }],
        }),
      ],
    });

    const cup = result.monedas.find((c) => c.moneda_codigo === "CUP")!;
    expect(cup.devengado_mes).toBe("480.00");
    expect(cup.pagado_mes).toBe("180.00");
    expect(cup.pendiente_pago).toBe("300.00");
    expect(result.cobertura.gastos_pendientes_pago).toBe(1);
  });

  test("el gasto anulado no aporta al devengo", () => {
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-anulado",
          amount: "1500.00",
          state: "ANULADO",
          updatedAt: new Date("2026-07-05T00:00:00.000Z"),
        }),
      ],
    });

    expect(result.cobertura.gastos_evaluados).toBe(0);
    expect(result.monedas).toHaveLength(0);
  });

  test("el mes futuro se marca como FUTURO sin devengar", () => {
    const result = buildGovernedExpenseReport({
      month: "2026-08",
      currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-agosto",
          belongingMonth: "2026-08",
          amount: "1500.00",
        }),
      ],
    });

    expect(result.estado_periodo).toBe("FUTURO");
    expect(result.fecha_corte).toBeNull();
  });

  test("el pago de otro mes en el mes reportado marca revisión", () => {
    // Un gasto de junio pagado en julio: el pago es flujo de caja de julio,
    // pero el devengo es de junio. Requiere revisión para no inflar el devengo.
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
      expenses: [
        baseExpense({
          expenseId: "gasto-junio",
          belongingMonth: "2026-06",
          amount: "1500.00",
          paidAt: new Date("2026-07-05T00:00:00.000Z"),
          paidAccumulated: "1500.00",
          state: "PAGADO",
          applications: [{
            amount: "1500.00",
            state: "APLICADA",
            paidAt: new Date("2026-07-05T00:00:00.000Z"),
            createdAt: new Date("2026-07-05T00:00:00.000Z"),
            updatedAt: new Date("2026-07-05T00:00:00.000Z"),
          }],
        }),
      ],
    });

    const cup = result.monedas.find((c) => c.moneda_codigo === "CUP")!;
    expect(cup.devengado_mes).toBe("0.00"); // no pertenece a julio
    expect(cup.pagado_mes).toBe("1500.00"); // pero el dinero salió en julio
    expect(result.cobertura.requieren_revision).toBe(1);
    expect(result.cobertura.completa).toBe(false);
  });

  test("clasifica cada pago por su propio día comercial y expone el acumulado real", () => {
    const result = buildGovernedExpenseReport({
      month: "2026-07",
      currentBusinessDate: new Date("2026-08-10T00:00:00.000Z"),
      expenses: [
        baseExpense({
          amount: "300.00",
          // La cabecera guarda el último pago y no puede reclasificar los
          // pagos anteriores: cada aplicación trae el día de su movimiento.
          paidAt: new Date("2026-08-03T00:00:00.000Z"),
          state: "PAGADO",
          paidAccumulated: "300.00",
          applications: [
            {
              applicationId: "app-junio",
              expenseId: "gasto-1",
              movementId: "mov-junio",
              amount: "100.00",
              state: "APLICADA",
              paidAt: new Date("2026-06-29T00:00:00.000Z"),
              appliedAt: new Date("2026-06-29T15:00:00.000Z"),
              createdAt: new Date("2026-06-29T15:00:00.000Z"),
              updatedAt: new Date("2026-06-29T15:00:00.000Z"),
            },
            {
              applicationId: "app-julio",
              expenseId: "gasto-1",
              movementId: "mov-julio",
              amount: "200.00",
              state: "APLICADA",
              paidAt: new Date("2026-07-08T00:00:00.000Z"),
              appliedAt: new Date("2026-07-08T16:00:00.000Z"),
              createdAt: new Date("2026-07-08T16:00:00.000Z"),
              updatedAt: new Date("2026-07-08T16:00:00.000Z"),
            },
          ],
        }),
      ],
    });

    const cup = result.monedas[0];
    expect(cup.pago_anticipado).toBe("100.00");
    expect(cup.pagado_mes).toBe("200.00");
    expect(cup.gastos[0].pagado_acumulado).toBe("300.00");
    expect(cup.gastos[0].aplicaciones.map((row) => row.aplicacion_id)).toEqual([
      "app-junio",
      "app-julio",
    ]);
  });

  test("rechaza un mes con formato inválido", () => {
    expect(() =>
      buildGovernedExpenseReport({
        month: "07/2026",
        currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
        expenses: [],
      }),
    ).toThrow(GovernedExpensePolicyError);
  });

  test("rechaza un importe no positivo", () => {
    expect(() =>
      buildGovernedExpenseReport({
        month: "2026-07",
        currentBusinessDate: new Date("2026-07-18T00:00:00.000Z"),
        expenses: [baseExpense({ amount: "0.00" })],
      }),
    ).toThrow(GovernedExpensePolicyError);
  });
});
