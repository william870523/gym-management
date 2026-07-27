import type { GovernedExpenseSnapshot } from "../../domain/governed-expense-policy";

/**
 * Contrato del lector de gastos devengados gobernados. El lector carga las
 * cabeceras de gasto junto con sus aplicaciones de pago y los catálogos
 * (categorías, proveedores, monedas) para alimentar la política de dominio.
 */
export interface GovernedExpenseReader {
  currentBusinessDate(gymId: string): Promise<Date>;
  readExpenses(gymId: string): Promise<GovernedExpenseSnapshot[]>;
}

/**
 * R4.6: contrato mínimo que el cierre mensual necesita para congelar el gasto
 * devengado dentro del snapshot firmado.
 */
export interface GovernedExpenseSnapshotProvider {
  get(input: { gymId: string; month?: unknown }): Promise<Record<string, any>>;
}
