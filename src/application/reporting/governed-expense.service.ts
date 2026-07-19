import {
  buildGovernedExpenseReport,
  GovernedExpensePolicyError,
} from "../../domain/governed-expense-policy";
import type { GovernedExpenseReader } from "./governed-expense.reader";

/**
 * Servicio de lectura del reporte de gastos devengados gobernados. Compone el
 * lector (snapshots) con la política de dominio (devengo por mes de
 * pertenencia) y traduce los errores de política a errores de aplicación.
 */
export class GovernedExpenseServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "GovernedExpenseServiceError";
  }
}

export class GovernedExpenseService {
  constructor(private readonly reader: GovernedExpenseReader) {}

  async get(input: { gymId: string; month?: unknown }) {
    if (!input.gymId.trim()) {
      throw new GovernedExpenseServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    try {
      const currentBusinessDate = await this.reader.currentBusinessDate(
        input.gymId,
      );
      const month = String(input.month ?? "").trim()
        || currentBusinessDate.toISOString().slice(0, 7);
      const expenses = await this.reader.readExpenses(input.gymId);
      return buildGovernedExpenseReport({
        month,
        currentBusinessDate,
        expenses,
      });
    } catch (error) {
      if (error instanceof GovernedExpensePolicyError) {
        throw new GovernedExpenseServiceError(error.message);
      }
      throw error;
    }
  }
}

export function asGovernedExpenseServiceError(error: unknown) {
  return error instanceof GovernedExpenseServiceError ? error : null;
}
