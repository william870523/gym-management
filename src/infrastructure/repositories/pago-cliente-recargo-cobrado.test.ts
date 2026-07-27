import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import { ProcessPaymentUseCase } from "../../application/use-cases/pago_cliente/ProcessPaymentUseCase";
import { PrismaPagoClienteRepository } from "./PrismaPagoClienteRepository";
import { PrismaPlanesPagoRepository } from "./PrismaPlanesPagoRepository";
import { PrismaClienteRepository } from "./PrismaClienteRepository";

/**
 * Cobro remoto CON recargo por mora (docs/RECARGO_MORA.md).
 *
 * `processPayment` construye a mano la fila del pago y de los detalles, así que
 * un campo que no se copie explícitamente se pierde. Se perdían dos cosas:
 *
 * 1. El snapshot congelado del recargo en el detalle: sin él no se puede
 *    reconstruir con qué regla ni sobre qué base se cobró.
 * 2. El recargo en `monto_total`, que quedaba solo con el importe del plan.
 *    Como tesorería reparte el encabezado entre los detalles, un detalle mayor
 *    que el encabezado se registraba como CAMBIO devuelto al socio: aparecía
 *    una salida de caja que nunca ocurrió y el ingreso del recargo se esfumaba.
 *    Comprobado revirtiendo el arreglo: salía `SALIDA CAMBIO_CLIENTE 3`.
 *
 * Siembra sus propios datos (no usa la fixture compartida) para no depender de
 * su estado ni importar módulos de fuera de `src`.
 */
describe("processPayment (Remote) · recargo por mora cobrado", () => {
  const gymId = "local-gym-001";
  const PREFIX = "prc-";
  const CI = "PRC000000001";
  // R5.6: el cobro exige cobrador autenticado del gimnasio del token.
  const COBRADOR = "prc-user-cobrador";
  const PLAN_ID = `${PREFIX}plan-pct`;
  const DIAS_ATRASO = 5;

  let paymentId = "";
  let membershipId = "";

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { user_id: COBRADOR } });
    await prisma.user.create({
      data: {
        user_id: COBRADOR,
        user_nombre: "Recepción Recargo",
        user_email: "prc.cobrador@test.local",
        password: "x",
        role: "recepcionista",
        active: true,
        gym_id: gymId,
      },
    });
    const currency = await prisma.moneda.findFirst({
      where: { codigo: "CUP", is_deleted: false },
    });
    const nationality = await prisma.nacionalidad.findFirst({
      where: { is_deleted: false },
    });
    const paymentType = await prisma.tipoPago.findFirst({
      where: { is_deleted: false },
    });
    const account = await prisma.cuenta.findFirst({
      where: {
        gym_id: gymId,
        moneda_id: currency?.moneda_id,
        is_deleted: false,
      },
    });
    if (!currency || !nationality || !paymentType || !account) {
      throw new Error("Faltan catálogos base (moneda CUP, nacionalidad, tipo de pago o cuenta).");
    }

    // Vencido hace 5 días respecto al día UTC de hoy, que es contra lo que
    // `calcularDiasAtraso` mide el atraso.
    const now = trustedClock.nowUtc();
    const todayUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const dueDate = new Date(todayUtc - DIAS_ATRASO * 86_400_000);

    await prisma.planesPago.create({
      data: {
        id_planes_pago: PLAN_ID,
        nombre_plan_pago: "Plan recargo % de prueba",
        importe_plan_pago: 30,
        duracion_plan_pago: 30,
        moneda_id: currency.moneda_id,
        activo: true,
        gym_id: gymId,
        recargo_mora_modo: "PORCENTAJE",
        recargo_mora_valor: "10.00",
        recargo_mora_tope: null,
        recargo_mora_activo: true,
      },
    });
    await prisma.cliente.create({
      data: {
        ci: CI,
        nombres: "Socio",
        apellidos: "Atrasado",
        sexo: "M",
        estatura_cliente: 1.75,
        nacionalidad_id: nationality.nacionalidad_id,
        fecha_inicio: new Date(todayUtc - 35 * 86_400_000),
        fecha_fin: dueDate,
        activo: true,
        gym_id: gymId,
      },
    });

    // Cobro completo sin condonar: base 30.00 + recargo 10 % = 33.00.
    const result = await new ProcessPaymentUseCase(
      new PrismaPagoClienteRepository(),
      new PrismaPlanesPagoRepository(),
      new PrismaClienteRepository(),
    ).execute(
      {
        ci: CI,
        id_planes_pago: PLAN_ID,
        moneda_id: currency.moneda_id,
        monto_total: 33,
        fecha: now.toISOString(),
        detalles: [
          {
            tipo_pago_id: paymentType.tipo_pago_id,
            moneda_id: currency.moneda_id,
            cuenta_id: account.cuenta_id,
            cantidad: 33,
          },
        ],
      } as any,
      gymId,
      COBRADOR,
    );
    paymentId = result.pago_cliente_id;
    membershipId =
      (
        await prisma.membresiaCliente.findFirst({
          where: { ci: CI, gym_id: gymId },
        })
      )?.membresia_id ?? "";
  });

  afterAll(async () => {
    await prisma.tesoreriaMovimiento.deleteMany({
      where: { gym_id: gymId, origen_id: paymentId },
    });
    await prisma.pagoMembresiaAplicacion.deleteMany({
      where: { pago_cliente_id: paymentId },
    });
    await prisma.detallePago.deleteMany({
      where: { pago_cliente_id: paymentId },
    });
    await prisma.pagoCliente.deleteMany({
      where: { pago_cliente_id: paymentId },
    });
    if (membershipId) {
      await prisma.membresiaEntrenadorAsignacion.deleteMany({
        where: { membresia_id: membershipId },
      });
      await prisma.membresiaCliente.deleteMany({
        where: { membresia_id: membershipId },
      });
    }
    await prisma.cliente.deleteMany({ where: { ci: CI } });
    await prisma.planesPago.deleteMany({ where: { id_planes_pago: PLAN_ID } });
    await prisma.user.deleteMany({ where: { user_id: COBRADOR } });
    await prisma.syncLog.deleteMany({
      where: { entidad_id: { in: [paymentId, membershipId, CI, PLAN_ID] } },
    });
  });

  test("el total cobrado incluye el recargo", async () => {
    const payment = await prisma.pagoCliente.findUnique({
      where: { pago_cliente_id: paymentId },
    });

    expect(Number(payment?.monto_total)).toBe(33);
  });

  test("el detalle conserva el snapshot congelado del recargo", async () => {
    const details = await prisma.detallePago.findMany({
      where: { pago_cliente_id: paymentId },
    });

    expect(details).toHaveLength(1);
    expect(details[0]!.recargo_mora_modo_snapshot).toBe("PORCENTAJE");
    expect(details[0]!.recargo_mora_dias_atraso).toBe(DIAS_ATRASO);
    expect(details[0]!.recargo_mora_base).toBe("30.00");
    expect(details[0]!.recargo_mora_importe).toBe("3.00");
    expect(details[0]!.recargo_mora_plan_valor).toBe("10.00");
    expect(details[0]!.recargo_mora_plan_tope).toBeNull();
  });

  test("tesorería no inventa un cambio devuelto al socio", async () => {
    const movements = await prisma.tesoreriaMovimiento.findMany({
      where: { gym_id: gymId, origen_id: paymentId },
    });

    expect(movements).toHaveLength(1);
    expect(movements[0]!.direccion).toBe("ENTRADA");
    expect(movements[0]!.concepto).toBe("PLAN_CLIENTE");
    expect(Number(movements[0]!.monto)).toBe(33);
    // Ni un solo movimiento de salida: no salió dinero de la caja.
    expect(movements.some((row) => row.direccion === "SALIDA")).toBe(false);
  });
});
