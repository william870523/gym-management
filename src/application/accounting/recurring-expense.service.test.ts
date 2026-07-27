import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";
import { RecurringExpenseService } from "./recurring-expense.service";

const GYM_ID = "local-gym-001";
const CATEGORY_ID = "test-r47-atomic-category";
const VALID_TEMPLATE_ID = "test-r47-atomic-01-valid";
const INVALID_TEMPLATE_ID = "test-r47-atomic-02-invalid";
const INVALID_CATEGORY_ID = "test-r47-atomic-missing-category";
const MONTH = "1998-01";

describe("RecurringExpenseService atomicidad mensual (remote)", () => {
  let currencyId = "";

  beforeAll(async () => {
    const currency = await prisma.moneda.findFirst({
      where: { codigo: "CUP", is_deleted: false },
      select: { moneda_id: true },
    });
    if (!currency) throw new Error("La prueba requiere la moneda CUP.");
    currencyId = currency.moneda_id;
    const now = trustedClock.nowUtc();
    await prisma.gastoCategoria.upsert({
      where: { categoria_id: CATEGORY_ID },
      create: {
        categoria_id: CATEGORY_ID,
        gym_id: GYM_ID,
        nombre: "[TEST R4.7] Atomicidad mensual",
        naturaleza: "OPERATIVO",
        created_at: now,
        updated_at: now,
      },
      update: { is_deleted: false, deleted_at: null, updated_at: now },
    });
    for (const [id, categoryId] of [
      [VALID_TEMPLATE_ID, CATEGORY_ID],
      [INVALID_TEMPLATE_ID, INVALID_CATEGORY_ID],
    ] as const) {
      await prisma.gastoRecurrente.upsert({
        where: { recurrente_id: id },
        create: {
          recurrente_id: id,
          gym_id: GYM_ID,
          categoria_id: categoryId,
          moneda_id: currencyId,
          descripcion: `[TEST R4.7] ${id}`,
          monto: "100.00",
          dia_programado: 10,
          mes_inicio: MONTH,
          mes_fin: MONTH,
          activo: true,
          created_at: now,
          updated_at: now,
        },
        update: {
          categoria_id: categoryId,
          moneda_id: currencyId,
          mes_inicio: MONTH,
          mes_fin: MONTH,
          activo: true,
          is_deleted: false,
          deleted_at: null,
          updated_at: now,
        },
      });
    }
  });

  afterAll(async () => {
    const templateIds = [VALID_TEMPLATE_ID, INVALID_TEMPLATE_ID];
    const expenses = await prisma.gastoGobernado.findMany({
      where: { recurrente_id: { in: templateIds } },
      select: { gasto_id: true },
    });
    const entityIds = [
      CATEGORY_ID,
      ...templateIds,
      ...expenses.map((row) => row.gasto_id),
    ];
    await prisma.$transaction(async (tx) => {
      await tx.syncLog.deleteMany({ where: { entidad_id: { in: entityIds } } });
      await tx.gastoGobernado.deleteMany({ where: { recurrente_id: { in: templateIds } } });
      await tx.gastoRecurrente.deleteMany({ where: { recurrente_id: { in: templateIds } } });
      await tx.gastoCategoria.deleteMany({ where: { categoria_id: CATEGORY_ID } });
    });
    await prisma.$disconnect();
  });

  it("revierte los gastos y sync_log anteriores si una plantilla posterior falla", async () => {
    const service = new RecurringExpenseService();
    await expect(service.generate(GYM_ID, { month: MONTH, userId: "SYSTEM" }))
      .rejects.toThrow("categoría especificada no existe");

    expect(await prisma.gastoGobernado.count({
      where: { recurrente_id: { in: [VALID_TEMPLATE_ID, INVALID_TEMPLATE_ID] } },
    })).toBe(0);
    expect(await prisma.syncLog.count({
      where: {
        gym_id: GYM_ID,
        entidad: "gasto_gobernado",
        payload_json: { contains: VALID_TEMPLATE_ID },
      },
    })).toBe(0);
  });
});
