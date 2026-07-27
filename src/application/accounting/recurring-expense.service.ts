import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  planRecurringExpenseGeneration,
  RecurringExpensePolicyError,
  type RecurringExpenseTemplateSnapshot,
} from "../../domain/recurring-expense-policy";
import { treasuryMinorToMoney, treasuryMoneyToMinor } from "../../domain/treasury-ledger-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { CompensationProfileService } from "./compensation-profile.service";
import {
  GovernedExpenseWriteService,
  GovernedExpenseWriteServiceError,
} from "./governed-expense-write.service";
import { TreasuryMonthLockedError } from "./treasury-month-lock.service";
import { serialize } from "../../shared/utils/serialize";

type Tx = Prisma.TransactionClient;
const DEVICE_ID = "WEB_ADMIN";

export class RecurringExpenseServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "RecurringExpenseServiceError";
  }
}

export interface CreateRecurringExpenseInput {
  categoria_id: string;
  proveedor_id?: string | null;
  moneda_id: string;
  descripcion: string;
  monto: string | number;
  dia_programado?: number | string | null;
  mes_inicio: string;
  mes_fin?: string | null;
  notas?: string | null;
}

export interface UpdateRecurringExpenseInput {
  recurrente_id: string;
  monto?: string | number | null;
  dia_programado?: number | string | null;
  mes_fin?: string | null;
  activo?: boolean | null;
  notas?: string | null;
}

/**
 * R4.7 — Plantillas de gasto recurrente y su generación mensual.
 *
 * La generación no escribe gastos por su cuenta: delega en
 * `GovernedExpenseWriteService.createExpense`, el mismo camino que un gasto
 * manual. Así hereda el bloqueo de mes cerrado y el snapshot de categoría sin
 * duplicar ninguna regla.
 */
export class RecurringExpenseService {
  private readonly profiles = new CompensationProfileService();
  private readonly expenses = new GovernedExpenseWriteService();

  async list(gymId: string) {
    return prisma.gastoRecurrente.findMany({
      where: { gym_id: gymId, is_deleted: false },
      orderBy: [{ activo: "desc" }, { descripcion: "asc" }],
    });
  }

  async create(gymId: string, input: CreateRecurringExpenseInput) {
    const descripcion = String(input.descripcion ?? "").trim();
    if (!descripcion) {
      throw new RecurringExpenseServiceError(
        "La descripción de la plantilla es obligatoria.",
      );
    }
    const montoMinor = treasuryMoneyToMinor(input.monto);
    if (montoMinor <= 0n) {
      throw new RecurringExpenseServiceError(
        "El importe de la plantilla debe ser positivo.",
      );
    }
    const dia = this.scheduledDay(input.dia_programado ?? 1);
    const mesInicio = this.month(input.mes_inicio, "El mes de inicio");
    const mesFin = input.mes_fin
      ? this.month(input.mes_fin, "El mes de término")
      : null;
    if (mesFin && mesFin < mesInicio) {
      throw new RecurringExpenseServiceError(
        "El mes de término no puede ser anterior al de inicio.",
      );
    }

    const now = trustedClock.nowUtc();
    const recurrenteId = `rec_${randomUUID()}`;

    return prisma.$transaction(async (tx) => {
      const category = await tx.gastoCategoria.findFirst({
        where: {
          categoria_id: input.categoria_id,
          gym_id: gymId,
          is_deleted: false,
        },
      });
      if (!category) {
        throw new RecurringExpenseServiceError(
          "La categoría especificada no existe.",
          404,
        );
      }
      if (input.proveedor_id) {
        const supplier = await tx.gastoProveedor.findFirst({
          where: {
            proveedor_id: input.proveedor_id,
            gym_id: gymId,
            is_deleted: false,
          },
        });
        if (!supplier) {
          throw new RecurringExpenseServiceError(
            "El proveedor especificado no existe.",
            404,
          );
        }
      }

      const currency = await tx.moneda.findFirst({
        where: { moneda_id: input.moneda_id, is_deleted: false },
        select: { moneda_id: true },
      });
      if (!currency) {
        throw new RecurringExpenseServiceError(
          "La moneda especificada no existe.",
          404,
        );
      }

      const row = await tx.gastoRecurrente.create({
        data: {
          recurrente_id: recurrenteId,
          gym_id: gymId,
          categoria_id: input.categoria_id,
          proveedor_id: input.proveedor_id ?? null,
          moneda_id: input.moneda_id,
          descripcion,
          monto: treasuryMinorToMoney(montoMinor),
          dia_programado: dia,
          mes_inicio: mesInicio,
          mes_fin: mesFin,
          activo: true,
          notas: input.notas?.trim() || null,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          version: 1,
          source_device: DEVICE_ID,
        },
      });
      await this.recordSync(tx, "INSERT", gymId, row);
      return row;
    });
  }

  async update(gymId: string, input: UpdateRecurringExpenseInput) {
    const now = trustedClock.nowUtc();
    return prisma.$transaction(async (tx) => {
      const current = await tx.gastoRecurrente.findFirst({
        where: {
          recurrente_id: input.recurrente_id,
          gym_id: gymId,
          is_deleted: false,
        },
      });
      if (!current) {
        throw new RecurringExpenseServiceError("La plantilla no existe.", 404);
      }

      const data: Record<string, unknown> = {
        updated_at: now,
        version: current.version + 1,
      };
      if (input.monto != null && input.monto !== "") {
        const montoMinor = treasuryMoneyToMinor(input.monto);
        if (montoMinor <= 0n) {
          throw new RecurringExpenseServiceError(
            "El importe de la plantilla debe ser positivo.",
          );
        }
        // El importe nuevo rige de aquí en adelante: los gastos ya generados
        // conservan el que tenían, porque ya pertenecen a su mes.
        data.monto = treasuryMinorToMoney(montoMinor);
      }
      if (input.dia_programado != null && input.dia_programado !== "") {
        data.dia_programado = this.scheduledDay(input.dia_programado);
      }
      if (input.mes_fin !== undefined) {
        const mesFin = input.mes_fin
          ? this.month(input.mes_fin, "El mes de término")
          : null;
        if (mesFin && mesFin < current.mes_inicio) {
          throw new RecurringExpenseServiceError(
            "El mes de término no puede ser anterior al de inicio.",
          );
        }
        data.mes_fin = mesFin;
      }
      if (input.activo != null) data.activo = input.activo;
      if (input.notas !== undefined) data.notas = input.notas?.trim() || null;

      const row = await tx.gastoRecurrente.update({
        where: { recurrente_id: input.recurrente_id },
        data,
      });
      await this.recordSync(tx, "UPDATE", gymId, row);
      return row;
    });
  }

  /** Qué se generaría para el mes, sin escribir nada. */
  async preview(gymId: string, month?: unknown) {
    const businessDate = await this.businessDate(gymId);
    const target = String(month ?? "").trim() ||
      businessDate.toISOString().slice(0, 7);
    const [templates, generated] = await Promise.all([
      this.snapshots(gymId),
      this.generatedFor(gymId, target),
    ]);
    return this.policy(() =>
      planRecurringExpenseGeneration({
        month: target,
        currentBusinessDate: businessDate,
        templates,
        generated,
      })
    );
  }

  /** Genera los gastos pendientes del mes y devuelve el plan ya ejecutado. */
  async generate(
    gymId: string,
    input: { month?: unknown; userId?: string | null },
  ) {
    const plan = await this.preview(gymId, input.month);
    if (!plan.puede_generar) {
      throw new RecurringExpenseServiceError(
        plan.motivo_bloqueo ?? "No hay nada que generar para este mes.",
        409,
      );
    }

    // Todo el mes se materializa como una sola unidad. Si una plantilla falla,
    // tampoco quedan gastos ni eventos de las anteriores.
    const created = await prisma.$transaction(async (tx) => {
      const rows: Array<{ recurrente_id: string; gasto_id: string }> = [];
      for (const pending of plan.a_generar) {
        try {
          const expense = await this.expenses.createExpense(gymId, {
            categoria_id: pending.categoria_id,
            proveedor_id: pending.proveedor_id,
            moneda_id: pending.moneda_id,
            descripcion: pending.descripcion,
            monto: pending.importe,
            periodo_pertenencia_mes: pending.mes_pertenencia,
            fecha_programada: `${pending.fecha_programada}T00:00:00.000Z`,
            registrada_por_user_id: input.userId ?? "SYSTEM",
            recurrente_id: pending.recurrente_id,
          }, tx);
          rows.push({
            recurrente_id: pending.recurrente_id,
            gasto_id: expense.gasto_id,
          });
        } catch (error) {
          if (error instanceof TreasuryMonthLockedError) {
            throw new RecurringExpenseServiceError(error.message, 409);
          }
          if (error instanceof GovernedExpenseWriteServiceError) {
            throw new RecurringExpenseServiceError(
              `No se pudo generar «${pending.descripcion}»: ${error.message}`,
              error.status,
            );
          }
          throw error;
        }
      }
      return rows;
    });

    // Se relee el plan para que la respuesta muestre el estado ya generado, no
    // el de antes de generar.
    const after = await this.preview(gymId, plan.mes);
    return { ...after, generados: created };
  }

  private async snapshots(
    gymId: string,
  ): Promise<RecurringExpenseTemplateSnapshot[]> {
    const rows = await prisma.gastoRecurrente.findMany({
      where: { gym_id: gymId, is_deleted: false },
      orderBy: { recurrente_id: "asc" },
    });
    const [categories, suppliers, currencies] = await Promise.all([
      prisma.gastoCategoria.findMany({ where: { gym_id: gymId } }),
      prisma.gastoProveedor.findMany({ where: { gym_id: gymId } }),
      prisma.moneda.findMany(),
    ]);
    const categoryById = new Map(categories.map((row) => [row.categoria_id, row]));
    const supplierById = new Map(suppliers.map((row) => [row.proveedor_id, row]));
    const currencyById = new Map(currencies.map((row) => [row.moneda_id, row]));

    return rows.map((row) => ({
      templateId: row.recurrente_id,
      categoryId: row.categoria_id,
      categoryName: categoryById.get(row.categoria_id)?.nombre ?? "—",
      supplierId: row.proveedor_id,
      supplierName: row.proveedor_id
        ? supplierById.get(row.proveedor_id)?.nombre ?? null
        : null,
      currencyId: row.moneda_id,
      currencyCode: currencyById.get(row.moneda_id)?.codigo ?? "—",
      description: row.descripcion,
      amount: row.monto.toString(),
      scheduledDay: row.dia_programado,
      startMonth: row.mes_inicio,
      endMonth: row.mes_fin,
      active: row.activo,
      notes: row.notas,
    }));
  }

  private async generatedFor(gymId: string, month: string) {
    const rows = await prisma.gastoGobernado.findMany({
      where: {
        gym_id: gymId,
        periodo_pertenencia_mes: month,
        recurrente_id: { not: null },
        is_deleted: false,
      },
      select: {
        gasto_id: true,
        recurrente_id: true,
        periodo_pertenencia_mes: true,
      },
    });
    return rows.map((row) => ({
      templateId: row.recurrente_id as string,
      month: row.periodo_pertenencia_mes,
      expenseId: row.gasto_id,
    }));
  }

  private async businessDate(gymId: string) {
    return prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())
    );
  }

  private scheduledDay(value: number | string) {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      throw new RecurringExpenseServiceError(
        "El día programado debe estar entre 1 y 28 para que exista en todos los meses.",
      );
    }
    return day;
  }

  private month(value: unknown, label: string) {
    const month = String(value ?? "").trim();
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    const monthNumber = match ? Number(match[2]) : 0;
    if (!match || monthNumber < 1 || monthNumber > 12) {
      throw new RecurringExpenseServiceError(
        `${label} debe usar el formato AAAA-MM con un mes entre 01 y 12.`,
      );
    }
    return month;
  }

  private async recordSync(
    tx: Tx,
    operation: "INSERT" | "UPDATE",
    gymId: string,
    row: { recurrente_id: string },
  ) {
    await tx.syncLog.create({
      data: {
        event_id: randomUUID(),
        entidad: "gasto_recurrente",
        operacion: operation,
        entidad_id: row.recurrente_id,
        gym_id: gymId,
        device_id: DEVICE_ID,
        payload_json: JSON.stringify(serialize(row)),
      },
    });
  }

  private policy<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof RecurringExpensePolicyError) {
        throw new RecurringExpenseServiceError(error.message);
      }
      throw error;
    }
  }
}

export function asRecurringExpenseServiceError(error: unknown) {
  return error instanceof RecurringExpenseServiceError ? error : null;
}
