import { describe, expect, test } from "bun:test";
import type { GovernedExpenseReader } from "./governed-expense.reader";
import type { GovernedExpenseSnapshot } from "../../domain/governed-expense-policy";
import {
  GovernedExpenseService,
  GovernedExpenseServiceError,
} from "./governed-expense.service";

class FakeReader implements GovernedExpenseReader {
  constructor(
    private readonly expenses: GovernedExpenseSnapshot[] = [],
    private readonly businessDate = new Date("2026-07-18T00:00:00.000Z"),
  ) {}

  async currentBusinessDate() {
    return this.businessDate;
  }

  async readExpenses() {
    return this.expenses;
  }
}

const baseExpense = (
  overrides: Partial<GovernedExpenseSnapshot> = {},
): GovernedExpenseSnapshot => ({
  expenseId: overrides.expenseId ?? "gasto-1",
  categoryId: overrides.categoryId ?? "cat-alquiler",
  categoryName: overrides.categoryName ?? "Alquiler",
  categoryNature: overrides.categoryNature ?? "OPERATIVO",
  supplierId: overrides.supplierId ?? null,
  supplierName: overrides.supplierName ?? null,
  currencyId: overrides.currencyId ?? "cup",
  currencyCode: overrides.currencyCode ?? "CUP",
  description: overrides.description ?? "Alquiler julio",
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

describe("GovernedExpenseService", () => {
  test("usa el mes de negocio cuando no se indica mes", async () => {
    const service = new GovernedExpenseService(
      new FakeReader([baseExpense()]),
    );
    const result = await service.get({ gymId: "gym-demo" });

    expect(result.mes).toBe("2026-07");
    expect(result.naturaleza).toBe("GASTO_DEVENGADO_GOBERNADO");
    expect(result.estado_periodo).toBe("PROVISIONAL");
    expect(result.monedas[0].devengado_mes).toBe("1500.00");
  });

  test("respeta el mes explícito pasado por parámetro", async () => {
    const service = new GovernedExpenseService(new FakeReader([]));
    const result = await service.get({ gymId: "gym-demo", month: "2026-08" });

    expect(result.mes).toBe("2026-08");
    expect(result.estado_periodo).toBe("FUTURO");
  });

  test("rechaza un gimnasio vacío antes de consultar datos", async () => {
    const service = new GovernedExpenseService(new FakeReader());
    await expect(
      service.get({ gymId: "  " }),
    ).rejects.toBeInstanceOf(GovernedExpenseServiceError);
  });

  test("convierte un mes ambiguo en error de aplicación", async () => {
    const service = new GovernedExpenseService(new FakeReader());
    await expect(
      service.get({ gymId: "gym-demo", month: "07/2026" }),
    ).rejects.toBeInstanceOf(GovernedExpenseServiceError);
  });

  test("separa monedas en el reporte", async () => {
    const service = new GovernedExpenseService(
      new FakeReader([
        baseExpense({
          expenseId: "gasto-cup",
          currencyId: "cup",
          currencyCode: "CUP",
          amount: "1500.00",
        }),
        baseExpense({
          expenseId: "gasto-usd",
          currencyId: "usd",
          currencyCode: "USD",
          amount: "60.00",
          categoryName: "Proveedores",
          description: "Internet julio",
        }),
      ]),
    );
    const result = await service.get({ gymId: "gym-demo" });

    expect(result.monedas).toHaveLength(2);
    expect(result.monedas[0].moneda_codigo).toBe("CUP");
    expect(result.monedas[1].moneda_codigo).toBe("USD");
    expect(result.monedas[0].devengado_mes).toBe("1500.00");
    expect(result.monedas[1].devengado_mes).toBe("60.00");
  });
});
