import { createHash } from "crypto";
import {
  AccrualOperatingResultPolicyError,
  buildAccrualOperatingResult,
} from "../../domain/accrual-operating-result-policy";
import { readGovernedExpenseFromSignedSnapshot } from
  "../../domain/governed-expense-certification-policy";
import { GovernedExpenseServiceError } from "./governed-expense.service";
import type { GovernedExpenseSnapshotProvider } from "./governed-expense.reader";
import type {
  ManagementMarginMonthlyCloseReader,
  ManagementMarginSnapshotProvider,
} from "./management-margin.reader";
import { ManagementMarginServiceError } from "./management-margin.service";

export class AccrualOperatingResultServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AccrualOperatingResultServiceError";
  }
}

/**
 * R4.6 — Compone el resultado operativo devengado a partir de los servicios ya
 * existentes: margen gerencial (R4.3/R4.4) y gasto devengado gobernado. No
 * consulta tablas nuevas.
 *
 * Certificación: el margen ya sabe leerse congelado desde el cierre firmado. El
 * gasto solo está congelado en snapshots v4 en adelante; para un mes cerrado con
 * un snapshot v3 el gasto se recalcula en vivo y el resultado se marca como
 * certificación parcial, sin fingir que la cifra completa está firmada.
 */
export class AccrualOperatingResultService {
  constructor(
    private readonly margin: ManagementMarginSnapshotProvider,
    private readonly expenses: GovernedExpenseSnapshotProvider,
    private readonly closeReader?: ManagementMarginMonthlyCloseReader,
  ) {}

  async get(input: { gymId: string; month?: unknown }): Promise<Record<string, any>> {
    if (!input.gymId.trim()) {
      throw new AccrualOperatingResultServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    const margin = await this.wrap(() =>
      this.margin.get({ gymId: input.gymId, month: input.month })
    );
    // El mes efectivo lo fija el margen: si la petición no trajo mes, resolvió
    // el mes comercial en curso y el gasto debe leerse del mismo período.
    const month = String(margin.mes ?? "").trim();
    const certifiedExpenses = await this.certifiedExpenses(input.gymId, month);
    const expenses = certifiedExpenses ??
      await this.wrap(() => this.expenses.get({ gymId: input.gymId, month }));

    const result = this.policy(() =>
      buildAccrualOperatingResult({ margin, expenses })
    );
    const marginCertified = margin.certificado === true;
    const expensesCertified = certifiedExpenses != null;
    return {
      ...result,
      estado_periodo: marginCertified && expensesCertified
        ? "CERTIFICADO"
        : String(result.estado_periodo ?? ""),
      certificado: marginCertified && expensesCertified,
      margen_certificado: marginCertified,
      gasto_certificado: expensesCertified,
      cierre_tesoreria: margin.cierre_tesoreria ?? null,
      nota_certificacion: this.certificationNote(marginCertified, expensesCertified),
    };
  }

  private certificationNote(margin: boolean, expenses: boolean) {
    if (margin && expenses) {
      return "Resultado operativo devengado congelado dentro del cierre mensual firmado; la huella SHA-256 fue verificada.";
    }
    if (margin && !expenses) {
      return "El margen está certificado pero el cierre firmado es anterior a R4.6: el gasto devengado se recalculó en vivo y el resultado todavía no está firmado por completo.";
    }
    return "El resultado operativo devengado es una proyección viva y no sustituye el cierre firmado.";
  }

  private async certifiedExpenses(gymId: string, month: string) {
    if (!this.closeReader || !month) return null;
    const close = await this.closeReader.readMonthlyClose(gymId, month);
    if (!close || close.state !== "CERRADO") return null;
    const signed = readGovernedExpenseFromSignedSnapshot({
      snapshotJson: close.snapshotJson,
      expectedHash: close.sha256,
      actualHash: this.hash(close.snapshotJson),
      gymId,
      month,
    });
    return signed?.result ?? null;
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.translate(error);
    }
  }

  private policy<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown) {
    if (error instanceof AccrualOperatingResultPolicyError) {
      return new AccrualOperatingResultServiceError(error.message);
    }
    if (
      error instanceof ManagementMarginServiceError ||
      error instanceof GovernedExpenseServiceError
    ) {
      return new AccrualOperatingResultServiceError(
        error.message,
        (error as { status?: number }).status ?? 400,
      );
    }
    return error;
  }
}

export function asAccrualOperatingResultServiceError(error: unknown) {
  return error instanceof AccrualOperatingResultServiceError ? error : null;
}
