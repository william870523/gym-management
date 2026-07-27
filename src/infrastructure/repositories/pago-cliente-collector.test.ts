import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import { ProcessPaymentUseCase } from "../../application/use-cases/pago_cliente/ProcessPaymentUseCase";
import { ApplyPagoClienteEventUseCase } from "../../application/use-cases/sync/ApplyPagoClienteEventUseCase";
import { PrismaPagoClienteRepository } from "./PrismaPagoClienteRepository";
import { PrismaPlanesPagoRepository } from "./PrismaPlanesPagoRepository";
import { PrismaClienteRepository } from "./PrismaClienteRepository";
import { PaymentActorError } from "../../application/payment/payment-actor";

/**
 * R5.6 — cobrador autenticado por pago, lado remoto/web
 * (docs/PAYMENT_COLLECTOR_ATTRIBUTION.md).
 *
 * Gemela de la prueba local, con las dos diferencias del remoto: aquí solo hay
 * `User` y además hay que revalidar la **sede**. Y una tercera regla propia:
 * un cobro que llega por sincronización conserva el actor congelado por la
 * instalación que cobró, en vez de atribuirse al dispositivo que lo sube.
 */
describe("processPayment (Remote) · cobrador autenticado", () => {
  const gymId = "local-gym-001";
  const OTHER_GYM = "pcc-gym-b";
  const CI = "PCC000000001";
  const PLAN_ID = "pcc-plan";
  const ANA = "pcc-user-ana";
  const INACTIVA = "pcc-user-inactiva";
  const AJENO = "pcc-user-ajeno";
  const PRECIO = 30;

  let currencyId = "";
  let paymentTypeId = "";
  let accountId = "";

  const useCase = () => new ProcessPaymentUseCase(
    new PrismaPagoClienteRepository(),
    new PrismaPlanesPagoRepository(),
    new PrismaClienteRepository(),
  );

  const cobrar = (actorUserId: string | null, extra: Record<string, unknown> = {}) =>
    useCase().execute(
      {
        ci: CI,
        id_planes_pago: PLAN_ID,
        moneda_id: currencyId,
        monto_total: PRECIO,
        fecha: trustedClock.nowUtc().toISOString(),
        detalles: [{
          tipo_pago_id: paymentTypeId,
          moneda_id: currencyId,
          cuenta_id: accountId,
          cantidad: PRECIO,
        }],
        ...extra,
      } as any,
      gymId,
      actorUserId,
    );

  async function wipe() {
    const memberships = await prisma.membresiaCliente.findMany({ where: { ci: CI } });
    for (const membership of memberships) {
      await prisma.membresiaCuota.deleteMany({
        where: { membresia_id: membership.membresia_id },
      });
      await prisma.membresiaEntrenadorAsignacion.deleteMany({
        where: { membresia_id: membership.membresia_id },
      });
      await prisma.pagoMembresiaAplicacion.deleteMany({
        where: { membresia_id: membership.membresia_id },
      });
    }
    const pagos = await prisma.pagoCliente.findMany({
      where: { ci: CI },
      select: { pago_cliente_id: true },
    });
    const ids = pagos.map((row) => row.pago_cliente_id);
    if (ids.length) {
      await prisma.tesoreriaMovimiento.deleteMany({ where: { origen_id: { in: ids } } });
      await prisma.detallePago.deleteMany({ where: { pago_cliente_id: { in: ids } } });
      await prisma.pagoCliente.deleteMany({ where: { pago_cliente_id: { in: ids } } });
      await prisma.syncLog.deleteMany({ where: { entidad_id: { in: ids } } });
    }
    await prisma.membresiaCliente.deleteMany({ where: { ci: CI } });
    await prisma.cliente.deleteMany({ where: { ci: CI } });
    await prisma.planesPago.deleteMany({ where: { id_planes_pago: PLAN_ID } });
    await prisma.user.deleteMany({
      where: { user_id: { in: [ANA, INACTIVA, AJENO] } },
    });
    await prisma.gym.deleteMany({ where: { gym_id: OTHER_GYM } });
  }

  beforeAll(async () => {
    await wipe();

    const currency = await prisma.moneda.findFirst({
      where: { codigo: "CUP", is_deleted: false },
    });
    const nationality = await prisma.nacionalidad.findFirst({ where: { is_deleted: false } });
    const paymentType = await prisma.tipoPago.findFirst({ where: { is_deleted: false } });
    const account = await prisma.cuenta.findFirst({
      where: { gym_id: gymId, moneda_id: currency?.moneda_id, is_deleted: false },
    });
    if (!currency || !nationality || !paymentType || !account) {
      throw new Error("Faltan catálogos base (moneda CUP, nacionalidad, tipo de pago o cuenta).");
    }
    currencyId = currency.moneda_id;
    paymentTypeId = paymentType.tipo_pago_id;
    accountId = account.cuenta_id;

    await prisma.gym.create({
      data: { gym_id: OTHER_GYM, codigo: "PCC-COD-B", nombre: "Gimnasio B", timezone: "Etc/UTC" },
    });
    await prisma.user.createMany({
      data: [
        {
          user_id: ANA,
          user_nombre: "Ana Recepción",
          user_email: "pcc.ana@test.local",
          password: "x",
          role: "recepcionista",
          active: true,
          gym_id: gymId,
        },
        {
          user_id: INACTIVA,
          user_nombre: "Cuenta De Baja",
          user_email: "pcc.baja@test.local",
          password: "x",
          role: "recepcionista",
          active: false,
          gym_id: gymId,
        },
        {
          user_id: AJENO,
          user_nombre: "Ajeno Otra Sede",
          user_email: "pcc.ajeno@test.local",
          password: "x",
          role: "recepcionista",
          active: true,
          gym_id: OTHER_GYM,
        },
      ],
    });

    await prisma.planesPago.create({
      data: {
        id_planes_pago: PLAN_ID,
        nombre_plan_pago: "Plan cobrador remoto",
        importe_plan_pago: PRECIO,
        duracion_plan_pago: 30,
        moneda_id: currencyId,
        activo: true,
        gym_id: gymId,
      },
    });
    const now = trustedClock.nowUtc();
    await prisma.cliente.create({
      data: {
        ci: CI,
        nombres: "Socio",
        apellidos: "Remoto Cobrador",
        sexo: "M",
        estatura_cliente: 1.8,
        nacionalidad_id: nationality.nacionalidad_id,
        fecha_inicio: now,
        fecha_fin: now,
        activo: true,
        categoria: "NUEVO",
        gym_id: gymId,
      },
    });
  });

  afterAll(async () => {
    await wipe();
  });

  test("sin sesión no se cobra y no queda nada escrito", async () => {
    await expect(cobrar(null)).rejects.toThrow(PaymentActorError);
    expect(await prisma.pagoCliente.count({ where: { ci: CI } })).toBe(0);
    expect(await prisma.membresiaCliente.count({ where: { ci: CI } })).toBe(0);
  });

  test("cuenta inactiva, de otra sede o inexistente no puede cobrar", async () => {
    await expect(cobrar(INACTIVA)).rejects.toThrow(/no está activa en este gimnasio/);
    // Existe y está activo, pero pertenece al gimnasio B: el token dice A.
    await expect(cobrar(AJENO)).rejects.toThrow(/no está activa en este gimnasio/);
    await expect(cobrar("no-existe")).rejects.toThrow(/no está activa en este gimnasio/);
  });

  test("el cuerpo no puede falsificar el cobrador", async () => {
    const pago = await cobrar(ANA, {
      cobrado_por_user_id: AJENO,
      cobrado_por_nombre_snapshot: "Quien yo diga",
      cobrado_por_rol_snapshot: "admin",
      cobrado_por_origen: "LOCAL_USER",
    });

    const saved = await prisma.pagoCliente.findUnique({
      where: { pago_cliente_id: pago.pago_cliente_id },
    });
    expect(saved?.cobrado_por_user_id).toBe(ANA);
    expect(saved?.cobrado_por_nombre_snapshot).toBe("Ana Recepción");
    expect(saved?.cobrado_por_rol_snapshot).toBe("recepcionista");
    expect(saved?.cobrado_por_origen).toBe("REMOTE_USER");
  });

  test("los movimientos de tesorería heredan al cobrador", async () => {
    const pago = await cobrar(ANA);
    const movimientos = await prisma.tesoreriaMovimiento.findMany({
      where: { gym_id: gymId, origen_id: pago.pago_cliente_id },
    });

    expect(movimientos.length).toBeGreaterThan(0);
    for (const movimiento of movimientos) {
      expect(movimiento.cobrado_por_user_id).toBe(ANA);
      expect(movimiento.cobrado_por_origen).toBe("REMOTE_USER");
    }
  });

  test("un cobro sincronizado conserva su cobrador original", async () => {
    const pagoId = "pcc-sync-pago";
    await new ApplyPagoClienteEventUseCase(new PrismaPagoClienteRepository()).execute({
      eventId: "pcc-sync-ev-1",
      entidadId: pagoId,
      operacion: "INSERT",
      gymId,
      deviceId: "dispositivo-que-sube",
      payload: {
        ci: CI,
        fecha: trustedClock.nowUtc().toISOString(),
        monto_total: PRECIO,
        id_planes_pago: PLAN_ID,
        moneda_id: currencyId,
        version: 1,
        // Cobrado en la instalación local por una cuenta que no existe en
        // MariaDB. Debe conservarse tal cual.
        cobrado_por_user_id: "local-ana",
        cobrado_por_nombre_snapshot: "ana.recepcion",
        cobrado_por_rol_snapshot: "recepcionista",
        cobrado_por_origen: "LOCAL_USER",
      } as any,
    });

    const saved = await prisma.pagoCliente.findUnique({
      where: { pago_cliente_id: pagoId },
    });
    expect(saved?.cobrado_por_user_id).toBe("local-ana");
    expect(saved?.cobrado_por_nombre_snapshot).toBe("ana.recepcion");
    // El dispositivo que sube el evento no se convierte en recepcionista.
    expect(saved?.cobrado_por_origen).toBe("LOCAL_USER");
    expect(saved?.source_device).toBe("dispositivo-que-sube");

    await prisma.pagoCliente.deleteMany({ where: { pago_cliente_id: pagoId } });
    await prisma.syncLog.deleteMany({ where: { entidad_id: pagoId } });
  });

  test("un cobro histórico sin actor sigue sin actor tras sincronizar", async () => {
    const pagoId = "pcc-sync-historico";
    await new ApplyPagoClienteEventUseCase(new PrismaPagoClienteRepository()).execute({
      eventId: "pcc-sync-ev-2",
      entidadId: pagoId,
      operacion: "INSERT",
      gymId,
      deviceId: "dispositivo-que-sube",
      payload: {
        ci: CI,
        fecha: trustedClock.nowUtc().toISOString(),
        monto_total: PRECIO,
        id_planes_pago: PLAN_ID,
        moneda_id: currencyId,
        version: 1,
      } as any,
    });

    const saved = await prisma.pagoCliente.findUnique({
      where: { pago_cliente_id: pagoId },
    });
    // «Sin atribuir · histórico»: nulo se queda nulo, no se rellena con nadie.
    expect(saved?.cobrado_por_user_id).toBeNull();
    expect(saved?.cobrado_por_origen).toBeNull();

    await prisma.pagoCliente.deleteMany({ where: { pago_cliente_id: pagoId } });
    await prisma.syncLog.deleteMany({ where: { entidad_id: pagoId } });
  });
});
