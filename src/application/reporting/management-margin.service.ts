import {
  buildManagementMarginReport,
  ManagementMarginPolicyError,
} from "../../domain/management-margin-policy";
import { createHash } from "crypto";
import {
  buildManagementMarginAnnualComparison,
  type ManagementMarginAnnualMonthInput,
  ManagementMarginAnnualPolicyError,
  parseManagementMarginYear,
} from "../../domain/management-margin-annual-policy";
import { readManagementMarginFromSignedSnapshot } from
  "../../domain/management-margin-certification-policy";
import { MembershipRevenuePolicyError } from "../../domain/membership-revenue-policy";
import { TrainerServiceCostPolicyError } from "../../domain/trainer-service-cost-policy";
import type {
  ManagementMarginMonthlyCloseReader,
  ManagementMarginMonthlyCloseReadRow,
  ManagementMarginSnapshotProvider,
} from "./management-margin.reader";
import type { MembershipRevenueReader } from "./membership-revenue.reader";
import type { TrainerServiceCostReader } from "./trainer-service-cost.reader";

export class ManagementMarginServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ManagementMarginServiceError";
  }
}

/**
 * R4.3 compone los lectores ya existentes de R4.1 y R4.2; no consulta tablas
 * nuevas ni reinterpreta las políticas de devengo.
 */
export class ManagementMarginService implements ManagementMarginSnapshotProvider {
  constructor(
    private readonly revenueReader: MembershipRevenueReader,
    private readonly costReader: TrainerServiceCostReader,
    private readonly closeReader?: ManagementMarginMonthlyCloseReader,
  ) {}

  async get(input: { gymId: string; month?: unknown }): Promise<Record<string, any>> {
    if (!input.gymId.trim()) {
      throw new ManagementMarginServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    const currentBusinessDate = await this.revenueReader.currentBusinessDate(
      input.gymId,
    );
    const month = String(input.month ?? "").trim()
      || currentBusinessDate.toISOString().slice(0, 7);
    const certified = await this.certifiedSnapshot(input.gymId, month);
    if (certified) return certified;
    const [memberships, costs] = await Promise.all([
      this.revenueReader.readMemberships(input.gymId),
      this.costReader.readCosts(input.gymId),
    ]);
    try {
      return this.withCloseStatus(input.gymId, month, buildManagementMarginReport({
        month,
        currentBusinessDate,
        memberships,
        costs,
      }));
    } catch (error) {
      if (
        error instanceof ManagementMarginPolicyError ||
        error instanceof MembershipRevenuePolicyError ||
        error instanceof TrainerServiceCostPolicyError
      ) {
        throw new ManagementMarginServiceError(error.message);
      }
      throw error;
    }
  }

  async getAnnual(input: {
    gymId: string;
    year?: unknown;
  }): Promise<Record<string, any>> {
    if (!input.gymId.trim()) {
      throw new ManagementMarginServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    const currentBusinessDate = await this.revenueReader.currentBusinessDate(
      input.gymId,
    );
    const currentBusinessMonth = currentBusinessDate.toISOString().slice(0, 7);
    const year = this.policy(() => parseManagementMarginYear(
      String(input.year ?? "").trim() || currentBusinessMonth.slice(0, 4),
    ));
    const closes = this.closeReader
      ? await this.closeReader.readMonthlyCloses(input.gymId, year)
      : [];
    const latestByMonth = new Map<string, ManagementMarginMonthlyCloseReadRow>();
    for (const close of [...closes].sort((a, b) =>
      b.closedAt.getTime() - a.closedAt.getTime()
    )) {
      if (!latestByMonth.has(close.month)) latestByMonth.set(close.month, close);
    }
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      return this.annualMonth(
        month,
        currentBusinessMonth,
        latestByMonth.get(month) ?? null,
        input.gymId,
      );
    });
    return this.policy(() => buildManagementMarginAnnualComparison({
      year,
      currentBusinessMonth,
      months,
    }));
  }

  private annualMonth(
    month: string,
    currentBusinessMonth: string,
    close: ManagementMarginMonthlyCloseReadRow | null,
    gymId: string,
  ): ManagementMarginAnnualMonthInput {
    if (!close) {
      if (month === currentBusinessMonth) {
        return { month, status: "EN_CURSO", reason: "Mes comercial en curso." };
      }
      if (month > currentBusinessMonth) {
        return { month, status: "FUTURO", reason: "Mes comercial futuro." };
      }
      return {
        month,
        status: "SIN_CIERRE",
        reason: "El mes terminó sin un cierre R4.4 certificado.",
      };
    }
    const evidence = {
      month,
      monthlyCloseId: close.monthlyCloseId,
      sha256: close.sha256,
      closedAt: close.closedAt.toISOString(),
    };
    if (close.state === "REABIERTO") {
      return {
        ...evidence,
        status: "REABIERTO",
        reason: "El último ciclo del mes fue reabierto y dejó de estar certificado.",
      };
    }
    if (close.state !== "CERRADO") {
      return {
        ...evidence,
        status: "SNAPSHOT_INCOMPATIBLE",
        reason: "El último ciclo tiene un estado no reconocido.",
      };
    }
    // R4.5.1: un cierre CERRADO debe conservar su bloqueo activo. Si lo perdió
    // no se certifica, pero tampoco se confunde con un cierre inexistente: el
    // operador debe ver la corrupción. El guard va antes de validar SHA.
    if (close.lockKey == null) {
      return {
        ...evidence,
        status: "BLOQUEO_INVALIDO",
        reason: "El cierre está CERRADO pero perdió su bloqueo activo.",
      };
    }
    const actualHash = this.hash(close.snapshotJson);
    if (actualHash !== close.sha256) {
      return {
        ...evidence,
        status: "INTEGRIDAD_INVALIDA",
        reason: "La huella SHA-256 del cierre no coincide con su snapshot.",
      };
    }
    let raw: Record<string, any>;
    try {
      raw = JSON.parse(close.snapshotJson) as Record<string, any>;
    } catch {
      return {
        ...evidence,
        status: "SNAPSHOT_INCOMPATIBLE",
        reason: "El snapshot firmado no contiene JSON válido.",
      };
    }
    if (Number(raw.version ?? 0) < 3) {
      return {
        ...evidence,
        status: "SNAPSHOT_ANTERIOR",
        reason: "El cierre certifica Tesorería y caja, pero usa un snapshot anterior a R4.4.",
      };
    }
    const signed = readManagementMarginFromSignedSnapshot({
      snapshotJson: close.snapshotJson,
      expectedHash: close.sha256,
      actualHash,
      gymId,
      month,
    });
    if (!signed) {
      return {
        ...evidence,
        status: "SNAPSHOT_INCOMPATIBLE",
        reason: "El snapshot no corresponde al gimnasio, mes o contrato R4.4 esperado.",
      };
    }
    return {
      ...evidence,
      status: "CERTIFICADO",
      reason: "Snapshot R4.4 certificado e íntegro.",
      result: signed.result,
    };
  }

  private async certifiedSnapshot(gymId: string, month: string) {
    if (!this.closeReader) return null;
    const close = await this.closeReader.readMonthlyClose(gymId, month);
    if (!close || close.state !== "CERRADO") return null;
    const actualHash = this.hash(close.snapshotJson);
    const signed = readManagementMarginFromSignedSnapshot({
      snapshotJson: close.snapshotJson,
      expectedHash: close.sha256,
      actualHash,
      gymId,
      month,
    });
    if (!signed) return null;
    const signer = signed.snapshot.firmado_por ?? {};
    return {
      ...signed.result,
      estado_periodo: "CERTIFICADO",
      certificado: true,
      cierre_tesoreria: {
        cierre_mensual_id: close.monthlyCloseId,
        estado: close.state,
        resumen_sha256: close.sha256,
        integridad_verificada: true,
        snapshot_version: Number(signed.snapshot.version),
        cerrado_at: close.closedAt.toISOString(),
        reabierto_at: null,
        firmado_por_nombre: String(signer.nombre ?? ""),
        firmado_por_rol: String(signer.rol ?? ""),
        motivo: String(signed.snapshot.motivo ?? ""),
        timezone: String(signed.snapshot.timezone ?? "Etc/UTC"),
        generado_at_utc: String(signed.snapshot.generado_at_utc ?? ""),
      },
      nota_certificacion:
        "Resultado devengado congelado dentro del cierre mensual; la huella SHA-256 fue verificada.",
    };
  }

  private async withCloseStatus(
    gymId: string,
    month: string,
    result: Record<string, any>,
  ) {
    if (!this.closeReader) {
      return {
        ...result,
        certificado: false,
        cierre_tesoreria: null,
        nota_certificacion:
          "El resultado devengado es una proyeccion viva y no sustituye el cierre firmado.",
      };
    }
    const close = await this.closeReader.readMonthlyClose(gymId, month);
    if (!close) {
      return {
        ...result,
        certificado: false,
        cierre_tesoreria: null,
        nota_certificacion:
          "El resultado devengado es una proyeccion viva y no sustituye el cierre firmado.",
      };
    }
    const integrity = this.hash(close.snapshotJson) === close.sha256;
    return {
      ...result,
      certificado: false,
      cierre_tesoreria: {
        cierre_mensual_id: close.monthlyCloseId,
        estado: close.state,
        resumen_sha256: close.sha256,
        integridad_verificada: integrity,
        cerrado_at: close.closedAt.toISOString(),
        reabierto_at: close.reopenedAt?.toISOString() ?? null,
      },
      nota_certificacion: integrity
        ? "El cierre mensual existente es anterior a R4.4; Tesoreria y caja pueden estar firmadas, pero el resultado devengado sigue provisional."
        : "La firma del cierre mensual no supera la verificacion de integridad; el resultado devengado no puede certificarse.",
    };
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private policy<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (
        error instanceof ManagementMarginPolicyError ||
        error instanceof ManagementMarginAnnualPolicyError ||
        error instanceof MembershipRevenuePolicyError ||
        error instanceof TrainerServiceCostPolicyError
      ) {
        throw new ManagementMarginServiceError(error.message);
      }
      throw error;
    }
  }
}

export function asManagementMarginServiceError(error: unknown) {
  return error instanceof ManagementMarginServiceError ? error : null;
}
