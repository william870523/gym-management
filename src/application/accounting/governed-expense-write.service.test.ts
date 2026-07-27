import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GovernedExpenseWriteService } from "./governed-expense-write.service";
import { prisma } from "../../infrastructure/db/prismaClient";

describe("GovernedExpenseWriteService (Remote)", () => {
  const service = new GovernedExpenseWriteService();
  // Usa el mismo gimnasio de integración que la instalación SQLite para
  // verificar también referencias reales de cuenta/moneda entre ambas bases.
  const gymId = "local-gym-001";
  const categoryIds: string[] = [];
  const supplierIds: string[] = [];
  const expenseIds: string[] = [];
  const applicationIds: string[] = [];
  const movementIds: string[] = [];
  let cupCurrencyId = "";

  beforeAll(async () => {
    const currency = await prisma.moneda.findUnique({ where: { codigo: "CUP" } });
    if (!currency || currency.is_deleted) throw new Error("Falta la moneda CUP de prueba.");
    cupCurrencyId = currency.moneda_id;
  });

  afterAll(async () => {
    const entityIds = [
      ...categoryIds,
      ...supplierIds,
      ...expenseIds,
      ...applicationIds,
      ...movementIds,
    ];
    await prisma.$transaction(async (tx) => {
      if (entityIds.length) {
        await tx.syncLog.deleteMany({ where: { entidad_id: { in: entityIds } } });
      }
      if (applicationIds.length) {
        await tx.gastoGobernadoAplicacion.deleteMany({
          where: { aplicacion_id: { in: applicationIds } },
        });
      }
      if (movementIds.length) {
        await tx.tesoreriaMovimiento.deleteMany({
          where: { movimiento_id: { in: movementIds } },
        });
      }
      if (expenseIds.length) {
        await tx.gastoGobernado.deleteMany({ where: { gasto_id: { in: expenseIds } } });
      }
      if (supplierIds.length) {
        await tx.gastoProveedor.deleteMany({
          where: { proveedor_id: { in: supplierIds } },
        });
      }
      if (categoryIds.length) {
        await tx.gastoCategoria.deleteMany({
          where: { categoria_id: { in: categoryIds } },
        });
      }
    });
  });

  test("crea categoría y la lista", async () => {
    const uniqueName = `Electricidad Remote Test ${Date.now()}`;
    const cat = await service.createCategory(gymId, {
      nombre: uniqueName,
      naturaleza: "OPERATIVO",
    });
    categoryIds.push(cat.categoria_id);

    expect(cat.categoria_id).toBeDefined();
    expect(cat.nombre).toBe(uniqueName);
    expect(cat.naturaleza).toBe("OPERATIVO");

    const categories = await service.listCategories(gymId);
    expect(categories.some((c) => c.categoria_id === cat.categoria_id)).toBe(true);
  });

  test("rechaza categoría duplicada", async () => {
    const uniqueName = `Dup Remote Category ${Date.now()}`;
    const category = await service.createCategory(gymId, {
      nombre: uniqueName,
      naturaleza: "ADMINISTRATIVO",
    });
    categoryIds.push(category.categoria_id);

    let error: any = null;
    try {
      await service.createCategory(gymId, {
        nombre: uniqueName,
        naturaleza: "ADMINISTRATIVO",
      });
    } catch (err) {
      error = err;
    }
    expect(error).not.toBeNull();
    expect(error.message).toContain("Ya existe una categoría con el nombre");
  });

  test("crea proveedor y lo lista", async () => {
    const uniqueName = `Proveedor Remote ${Date.now()}`;
    const doc = `DOC-REM-${Date.now()}`;
    const prov = await service.createSupplier(gymId, {
      nombre: uniqueName,
      documento: doc,
    });
    supplierIds.push(prov.proveedor_id);

    expect(prov.proveedor_id).toBeDefined();
    expect(prov.nombre).toBe(uniqueName);
    expect(prov.documento).toBe(doc);

    const suppliers = await service.listSuppliers(gymId);
    expect(suppliers.some((s) => s.proveedor_id === prov.proveedor_id)).toBe(true);
  });

  test("crea un gasto devengado pendiente", async () => {
    const cat = await service.createCategory(gymId, {
      nombre: `Cat Remote ${Date.now()}`,
      naturaleza: "OPERATIVO",
    });
    categoryIds.push(cat.categoria_id);

    const expense = await service.createExpense(gymId, {
      categoria_id: cat.categoria_id,
      moneda_id: cupCurrencyId,
      descripcion: "Prueba Alquiler Remote",
      monto: "500.00",
      periodo_pertenencia_mes: "2026-07",
    });
    expenseIds.push(expense.gasto_id);

    expect(expense.gasto_id).toBeDefined();
    expect(expense.estado).toBe("PENDIENTE");
    expect(expense.monto.toString()).toBe("500");
    expect(expense.periodo_pertenencia_mes).toBe("2026-07");
  });

  test("paga un gasto parcialmente y luego totalmente con movimiento de tesorería", async () => {
    const cat = await service.createCategory(gymId, {
      nombre: `Cat Paga Remote ${Date.now()}`,
      naturaleza: "OPERATIVO",
    });
    categoryIds.push(cat.categoria_id);

    const expense = await service.createExpense(gymId, {
      categoria_id: cat.categoria_id,
      moneda_id: cupCurrencyId,
      descripcion: "Gasto a Pagar Remote",
      monto: "1000.00",
      periodo_pertenencia_mes: "2026-07",
    });
    expenseIds.push(expense.gasto_id);

    // Pago 1: 400.00 (PARCIAL)
    const pay1 = await service.payExpense(gymId, {
      gasto_id: expense.gasto_id,
      monto: "400.00",
    });
    applicationIds.push(pay1.application.aplicacion_id);
    movementIds.push(pay1.movement.movimiento_id);

    expect(pay1.expense.estado).toBe("PARCIAL");
    expect(pay1.movement.movimiento_id).toBeDefined();

    // Pago 2: 600.00 (PAGADO)
    const pay2 = await service.payExpense(gymId, {
      gasto_id: expense.gasto_id,
      monto: "600.00",
    });
    applicationIds.push(pay2.application.aplicacion_id);
    movementIds.push(pay2.movement.movimiento_id);

    expect(pay2.expense.estado).toBe("PAGADO");

    // Pago excedente debe fallar
    let error: any = null;
    try {
      await service.payExpense(gymId, {
        gasto_id: expense.gasto_id,
        monto: "100.00",
      });
    } catch (err) {
      error = err;
    }
    expect(error).not.toBeNull();
    expect(error.message).toContain("El gasto ya está pagado en su totalidad");
  });

  test("revierta el pago de un gasto afectando acumulado y creando contramovimiento", async () => {
    const account = await prisma.cuenta.findFirst({
      where: { gym_id: gymId, moneda_id: cupCurrencyId, is_deleted: false },
    });
    expect(account).not.toBeNull();
    const cat = await service.createCategory(gymId, {
      nombre: `Cat Reversión Remote ${Date.now()}`,
      naturaleza: "OPERATIVO",
    });
    categoryIds.push(cat.categoria_id);

    const expense = await service.createExpense(gymId, {
      categoria_id: cat.categoria_id,
      moneda_id: cupCurrencyId,
      descripcion: "Gasto a Reversar Remote",
      monto: "300.00",
      periodo_pertenencia_mes: "2026-07",
    });
    expenseIds.push(expense.gasto_id);

    const pay = await service.payExpense(gymId, {
      gasto_id: expense.gasto_id,
      monto: "300.00",
      cuenta_id: account!.cuenta_id,
    });
    applicationIds.push(pay.application.aplicacion_id);
    movementIds.push(pay.movement.movimiento_id);

    expect(pay.expense.estado).toBe("PAGADO");

    const reversal = await service.reversePayment(gymId, {
      aplicacion_id: pay.application.aplicacion_id,
      motivo: "Error en pago de caja",
    });
    movementIds.push(reversal.reversalMovement.movimiento_id);

    expect(reversal.expense.estado).toBe("PENDIENTE");
    expect(reversal.application.estado).toBe("REVERSADA");
    expect(reversal.reversalMovement.movimiento_id).toBeDefined();
    const reversalMovement = await prisma.tesoreriaMovimiento.findUnique({
      where: { movimiento_id: reversal.reversalMovement.movimiento_id },
    });
    expect(reversalMovement?.cuenta_id).toBe(account!.cuenta_id);
  });
});
