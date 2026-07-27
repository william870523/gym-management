import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import { ProcessPaymentUseCase } from "../../application/use-cases/pago_cliente/ProcessPaymentUseCase";
import { PrismaPagoClienteRepository } from "./PrismaPagoClienteRepository";
import { PrismaPlanesPagoRepository } from "./PrismaPlanesPagoRepository";
import { PrismaClienteRepository } from "./PrismaClienteRepository";
import { PlanInstallmentService } from "../../application/membership/plan-installment.service";
import { datePartsInZone } from "../../config/tz";
import { env } from "../../config/env";

/**
 * R5.2 — cobro por cuotas en el remoto (docs/PLAN_INSTALLMENTS.md).
 *
 * El remoto ignoraba `modo_cuotas` por completo: solo sabía cobrar el plan
 * entero. Estas pruebas fijan el contrato portado desde local, con el importe y
 * el recargo resueltos DENTRO de la transacción del cobro.
 *
 * Reglas de dinero que fijan (docs/RECARGO_MORA.md §6-ter): cada cuota atrasada
 * cobra su propio recargo, y el recargo NO paga plan.
 */
describe("processPayment (Remote) · cobro por cuotas", () => {
  const gymId = "local-gym-001";
  const OTHER_GYM = "pci-gym-b";
  const CI = "PCI000000001";
  // R5.6: el cobro exige cobrador autenticado del mismo gimnasio.
  const COBRADOR = "pci-user-cobrador";
  const COBRADOR_B = "pci-user-cobrador-b";
  const PLAN_ID = "pci-plan-cuotas";
  const PRECIO_PLAN = 30;
  const CUOTA = 10;

  let currencyId = "";
  let paymentTypeId = "";
  let accountId = "";
  let nationalityId = "";
  let membershipId = "";
  let todayUtc = 0;

  const useCase = () => new ProcessPaymentUseCase(
    new PrismaPagoClienteRepository(),
    new PrismaPlanesPagoRepository(),
    new PrismaClienteRepository(),
  );

  const detalle = (cantidad: number) => [{
    tipo_pago_id: paymentTypeId,
    moneda_id: currencyId,
    cuenta_id: accountId,
    cantidad,
  }];

  const cobrar = (input: {
    monto: number;
    numeroCuota?: number;
    membresia?: string | null;
  }) => useCase().execute(
    {
      ci: CI,
      id_planes_pago: PLAN_ID,
      moneda_id: currencyId,
      monto_total: input.monto,
      fecha: trustedClock.nowUtc().toISOString(),
      modo_cuotas: true,
      numero_cuota: input.numeroCuota ?? null,
      membresia_id: input.membresia ?? null,
      detalles: detalle(input.monto),
    } as any,
    gymId,
    COBRADOR,
  );

  async function wipe() {
    for (const ci of [CI]) {
      const memberships = await prisma.membresiaCliente.findMany({ where: { ci } });
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
        where: { ci },
        select: { pago_cliente_id: true },
      });
      const ids = pagos.map((row) => row.pago_cliente_id);
      if (ids.length) {
        await prisma.tesoreriaMovimiento.deleteMany({ where: { origen_id: { in: ids } } });
        await prisma.detallePago.deleteMany({ where: { pago_cliente_id: { in: ids } } });
        await prisma.pagoCliente.deleteMany({ where: { pago_cliente_id: { in: ids } } });
      }
      await prisma.membresiaCliente.deleteMany({ where: { ci } });
      await prisma.cliente.deleteMany({ where: { ci } });
    }
    await prisma.planCuotaEsquema.deleteMany({ where: { plan_id: PLAN_ID } });
    await prisma.planesPago.deleteMany({ where: { id_planes_pago: PLAN_ID } });
    await prisma.user.deleteMany({
      where: { user_id: { in: [COBRADOR, COBRADOR_B] } },
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
    await prisma.user.create({
      data: {
        user_id: COBRADOR,
        user_nombre: "Recepción Remota",
        user_email: "pci.cobrador@test.local",
        password: "x",
        role: "recepcionista",
        active: true,
        gym_id: gymId,
      },
    });
    currencyId = currency.moneda_id;
    nationalityId = nationality.nacionalidad_id;
    paymentTypeId = paymentType.tipo_pago_id;
    accountId = account.cuenta_id;

    // El atraso se mide contra la FECHA DE NEGOCIO del gimnasio, no contra el
    // día UTC. Anclando aquí el vencimiento al día UTC, entre la medianoche UTC
    // y el cambio de día del gimnasio los cinco días de atraso salían cuatro y
    // la prueba fallaba solo a ciertas horas.
    const gym = await prisma.gym.findUnique({
      where: { gym_id: gymId },
      select: { timezone: true },
    });
    const parts = datePartsInZone(
      gym?.timezone ?? env.defaultGymTimezone,
      trustedClock.nowUtc(),
    );
    todayUtc = Date.UTC(parts.year, parts.month - 1, parts.day);

    // Plan de 30.00 en tres cuotas de 10.00 (10 días cada una), recargo 10 %.
    await prisma.planesPago.create({
      data: {
        id_planes_pago: PLAN_ID,
        nombre_plan_pago: "Plan remoto por cuotas",
        importe_plan_pago: PRECIO_PLAN,
        duracion_plan_pago: 30,
        moneda_id: currencyId,
        activo: true,
        gym_id: gymId,
        acepta_cuotas: true,
        recargo_mora_modo: "PORCENTAJE",
        recargo_mora_valor: "10.00",
        recargo_mora_activo: true,
      },
    });
    for (const numero of [1, 2, 3]) {
      await prisma.planCuotaEsquema.create({
        data: {
          esquema_id: `${PLAN_ID}-t${numero}`,
          gym_id: gymId,
          plan_id: PLAN_ID,
          numero_cuota: numero,
          importe: CUOTA,
          dias_cobertura: 10,
          orden: numero,
        },
      });
    }
    await prisma.cliente.create({
      data: {
        ci: CI,
        nombres: "Socio",
        apellidos: "Remoto Cuotas",
        sexo: "M",
        estatura_cliente: 1.8,
        nacionalidad_id: nationalityId,
        fecha_inicio: new Date(todayUtc),
        fecha_fin: new Date(todayUtc),
        activo: true,
        categoria: "NUEVO",
        gym_id: gymId,
      },
    });
  });

  afterAll(async () => {
    await wipe();
  });

  test("la cuota 1 activa la membresía y materializa las tres", async () => {
    await cobrar({ monto: CUOTA });

    const membership = await prisma.membresiaCliente.findFirst({ where: { ci: CI } });
    membershipId = membership!.membresia_id;
    const cuotas = await new PlanInstallmentService().listMembershipQuotas(
      prisma as any,
      gymId,
      membershipId,
    );

    expect(membership!.estado).toBe("ACTIVA");
    // Solo la cuota 1: el plan sigue debiendo 20.00.
    expect(Number(membership!.importe_pagado)).toBe(CUOTA);
    expect(cuotas).toHaveLength(3);
    expect(cuotas.map((row) => row.estado)).toEqual(["PAGADA", "PENDIENTE", "PENDIENTE"]);
    // La vigencia llega solo al final del primer tramo, no a los 30 días.
    expect(membership!.fecha_fin.getTime()).toBe(
      cuotas[0]!.fecha_cobertura_fin.getTime(),
    );
  });

  test("no deja saltarse una cuota", async () => {
    await expect(
      cobrar({ monto: CUOTA, numeroCuota: 3, membresia: membershipId }),
    ).rejects.toThrow(/anterior\(es\) sin pagar/);
  });

  test("exige el importe exacto de la cuota", async () => {
    await expect(
      cobrar({ monto: CUOTA + 5, numeroCuota: 2, membresia: membershipId }),
    ).rejects.toThrow(/requiere/);
  });

  test("la cuota atrasada cobra su recargo y amplía la vigencia", async () => {
    const cuota2 = await prisma.membresiaCuota.findFirst({
      where: { membresia_id: membershipId, numero_cuota: 2 },
    });
    await prisma.membresiaCuota.update({
      where: { cuota_instancia_id: cuota2!.cuota_instancia_id },
      data: { fecha_exigible: new Date(todayUtc - 5 * 86_400_000) },
    });

    // 10.00 de cuota + 1.00 de recargo (10 %).
    const pago = await cobrar({
      monto: CUOTA + 1,
      numeroCuota: 2,
      membresia: membershipId,
    });

    const saved = await prisma.pagoCliente.findUnique({
      where: { pago_cliente_id: pago.pago_cliente_id },
    });
    const detalles = await prisma.detallePago.findMany({
      where: { pago_cliente_id: pago.pago_cliente_id },
    });
    const membership = await prisma.membresiaCliente.findUnique({
      where: { membresia_id: membershipId },
    });

    expect(Number(saved?.monto_total)).toBe(11);
    expect(detalles[0]!.recargo_mora_importe).toBe("1.00");
    expect(detalles[0]!.recargo_mora_dias_atraso).toBe(5);
    // El recargo NO paga plan: 10 + 10, no 21.
    expect(Number(membership?.importe_pagado)).toBe(20);
    expect(membership!.fecha_fin.getTime()).toBe(
      cuota2!.fecha_cobertura_fin.getTime(),
    );
  });

  test("una cuota ya pagada no se cobra dos veces", async () => {
    await expect(
      cobrar({ monto: CUOTA, numeroCuota: 2, membresia: membershipId }),
    ).rejects.toThrow(/ya está pagada/);
  });

  test("tesorería registra el cobro sin inventar cambio devuelto", async () => {
    const pagos = await prisma.pagoCliente.findMany({
      where: { ci: CI },
      select: { pago_cliente_id: true },
    });
    const movimientos = await prisma.tesoreriaMovimiento.findMany({
      where: {
        gym_id: gymId,
        origen_id: { in: pagos.map((row) => row.pago_cliente_id) },
      },
    });

    expect(movimientos.every((row) => row.direccion === "ENTRADA")).toBe(true);
    // 10.00 de la cuota 1 y 11.00 de la cuota 2 con recargo.
    expect(
      movimientos.reduce((sum, row) => sum + Number(row.monto), 0),
    ).toBe(21);
  });

  test("no cobra una cuota de una membresía de otro gimnasio", async () => {
    await prisma.gym.create({
      data: { gym_id: OTHER_GYM, codigo: "PCI-COD-B", nombre: "Gimnasio B", timezone: "Etc/UTC" },
    });
    // Cobrador legítimo del gimnasio B: así el rechazo sigue siendo por la
    // membresía ajena y no por la identidad, que es lo que mide esta prueba.
    await prisma.user.create({
      data: {
        user_id: COBRADOR_B,
        user_nombre: "Recepción Gimnasio B",
        user_email: "pci.cobrador.b@test.local",
        password: "x",
        role: "recepcionista",
        active: true,
        gym_id: OTHER_GYM,
      },
    });

    // La membresía existe, pero el token dice otro gimnasio.
    await expect(
      new ProcessPaymentUseCase(
        new PrismaPagoClienteRepository(),
        new PrismaPlanesPagoRepository(),
        new PrismaClienteRepository(),
      ).execute(
        {
          ci: CI,
          id_planes_pago: PLAN_ID,
          moneda_id: currencyId,
          monto_total: CUOTA,
          fecha: trustedClock.nowUtc().toISOString(),
          modo_cuotas: true,
          numero_cuota: 3,
          membresia_id: membershipId,
          detalles: detalle(CUOTA),
        } as any,
        OTHER_GYM,
        COBRADOR_B,
      ),
    ).rejects.toThrow();
  });
});
