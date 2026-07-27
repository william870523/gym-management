import { CompensationProfileService } from "../../application/accounting/compensation-profile.service";
import type { GovernedExpenseReader } from "../../application/reporting/governed-expense.reader";
import type {
  GovernedExpenseApplicationSnapshot,
  GovernedExpenseSnapshot,
} from "../../domain/governed-expense-policy";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";

function toCanonicalUtcDate(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) {
    return new Date(Date.UTC(1970, 0, 1));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export class PrismaGovernedExpenseReader implements GovernedExpenseReader {
  private readonly profiles = new CompensationProfileService();

  async currentBusinessDate(gymId: string) {
    return prisma.$transaction((tx) =>
      this.profiles.businessToday(tx, gymId, trustedClock.nowUtc()),
    );
  }

  async readExpenses(gymId: string): Promise<GovernedExpenseSnapshot[]> {
    const [expenses, applications, categories, suppliers, currencies, movements] = await Promise.all([
      prisma.gastoGobernado.findMany({
        where: { gym_id: gymId, is_deleted: false },
        orderBy: [{ periodo_pertenencia_mes: "asc" }, { gasto_id: "asc" }],
      }),
      prisma.gastoGobernadoAplicacion.findMany({
        where: { gym_id: gymId, is_deleted: false },
        orderBy: [{ aplicada_at: "asc" }, { aplicacion_id: "asc" }],
      }),
      prisma.gastoCategoria.findMany({
        where: { gym_id: gymId, is_deleted: false },
      }),
      prisma.gastoProveedor.findMany({
        where: { gym_id: gymId, is_deleted: false },
      }),
      prisma.moneda.findMany(),
      prisma.tesoreriaMovimiento.findMany({
        where: {
          gym_id: gymId,
          origen_tipo: "GASTO_GOBERNADO",
          is_deleted: false,
        },
        select: {
          movimiento_id: true,
          fecha_negocio: true,
          moneda_id: true,
        },
      }),
    ]);

    const categoryById = new Map(categories.map((c) => [c.categoria_id, c]));
    const supplierById = new Map(suppliers.map((s) => [s.proveedor_id, s]));
    const currencyById = new Map(
      currencies.map((c) => [c.moneda_id, c.codigo]),
    );
    const movementById = new Map(
      movements.map((movement) => [movement.movimiento_id, movement]),
    );
    const applicationsByExpense = new Map<string, GovernedExpenseApplicationSnapshot[]>();
    for (const app of applications) {
      const movement = movementById.get(app.movimiento_id);
      if (!movement) {
        throw new Error(
          `La aplicación ${app.aplicacion_id} no conserva su movimiento de Tesorería.`,
        );
      }
      const list = applicationsByExpense.get(app.gasto_id) ?? [];
      list.push({
        applicationId: app.aplicacion_id,
        expenseId: app.gasto_id,
        movementId: app.movimiento_id,
        amount: app.monto_aplicado.toString(),
        state: app.estado === "REVERSADA" ? "REVERSADA" : "APLICADA",
        paidAt: toCanonicalUtcDate(movement.fecha_negocio),
        appliedAt: app.aplicada_at,
        createdAt: app.created_at,
        updatedAt: app.updated_at,
      });
      applicationsByExpense.set(app.gasto_id, list);
    }

    return expenses.map((expense) => {
      const category = categoryById.get(expense.categoria_id);
      const supplier = expense.proveedor_id
        ? supplierById.get(expense.proveedor_id)
        : null;
      return {
        expenseId: expense.gasto_id,
        categoryId: expense.categoria_id,
        categoryName: category?.nombre ?? "Sin categoría",
        categoryNature: category?.naturaleza ?? "OPERATIVO",
        supplierId: expense.proveedor_id,
        supplierName: supplier?.nombre ?? null,
        currencyId: expense.moneda_id,
        currencyCode: currencyById.get(expense.moneda_id) ?? expense.moneda_id,
        description: expense.descripcion,
        amount: expense.monto.toString(),
        belongingMonth: expense.periodo_pertenencia_mes,
        scheduledDate: toCanonicalUtcDate(expense.fecha_programada),
        paidAt: expense.fecha_pago ? toCanonicalUtcDate(expense.fecha_pago) : null,
        state: expense.estado,
        paidAccumulated: expense.pagado_acumulado.toString(),
        receiptReference: expense.comprobante_referencia,
        registeredByUserId: expense.registrada_por_user_id,
        createdAt: expense.created_at,
        updatedAt: expense.updated_at,
        applications: applicationsByExpense.get(expense.gasto_id) ?? [],
      };
    });
  }
}
