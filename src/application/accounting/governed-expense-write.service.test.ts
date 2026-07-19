import { describe, expect, test } from "bun:test";
import { GovernedExpenseWriteService } from "./governed-expense-write.service";

describe("GovernedExpenseWriteService (Remote)", () => {
  const service = new GovernedExpenseWriteService();
  const gymId = "demo-gym-001";

  test("crea categoría y la lista", async () => {
    const uniqueName = `Electricidad Remote Test ${Date.now()}`;
    const cat = await service.createCategory(gymId, {
      nombre: uniqueName,
      naturaleza: "OPERATIVO",
    });

    expect(cat.categoria_id).toBeDefined();
    expect(cat.nombre).toBe(uniqueName);
    expect(cat.naturaleza).toBe("OPERATIVO");

    const categories = await service.listCategories(gymId);
    expect(categories.some((c) => c.categoria_id === cat.categoria_id)).toBe(true);
  });

  test("rechaza categoría duplicada", async () => {
    const uniqueName = `Dup Remote Category ${Date.now()}`;
    await service.createCategory(gymId, {
      nombre: uniqueName,
      naturaleza: "ADMINISTRATIVO",
    });

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

    const expense = await service.createExpense(gymId, {
      categoria_id: cat.categoria_id,
      moneda_id: "CUP",
      descripcion: "Prueba Alquiler Remote",
      monto: "500.00",
      periodo_pertenencia_mes: "2026-07",
    });

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

    const expense = await service.createExpense(gymId, {
      categoria_id: cat.categoria_id,
      moneda_id: "CUP",
      descripcion: "Gasto a Pagar Remote",
      monto: "1000.00",
      periodo_pertenencia_mes: "2026-07",
    });

    // Pago 1: 400.00 (PARCIAL)
    const pay1 = await service.payExpense(gymId, {
      gasto_id: expense.gasto_id,
      monto: "400.00",
    });

    expect(pay1.expense.estado).toBe("PARCIAL");
    expect(pay1.movement.movimiento_id).toBeDefined();

    // Pago 2: 600.00 (PAGADO)
    const pay2 = await service.payExpense(gymId, {
      gasto_id: expense.gasto_id,
      monto: "600.00",
    });

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
    const cat = await service.createCategory(gymId, {
      nombre: `Cat Reversión Remote ${Date.now()}`,
      naturaleza: "OPERATIVO",
    });

    const expense = await service.createExpense(gymId, {
      categoria_id: cat.categoria_id,
      moneda_id: "CUP",
      descripcion: "Gasto a Reversar Remote",
      monto: "300.00",
      periodo_pertenencia_mes: "2026-07",
    });

    const pay = await service.payExpense(gymId, {
      gasto_id: expense.gasto_id,
      monto: "300.00",
    });

    expect(pay.expense.estado).toBe("PAGADO");

    const reversal = await service.reversePayment(gymId, {
      aplicacion_id: pay.application.aplicacion_id,
      motivo: "Error en pago de caja",
    });

    expect(reversal.expense.estado).toBe("PENDIENTE");
    expect(reversal.application.estado).toBe("REVERSADA");
    expect(reversal.reversalMovement.movimiento_id).toBeDefined();
  });
});
