import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { PrismaAsistenciaRepository } from "../../../infrastructure/repositories/PrismaAsistenciaRepository";
import { CreateAsistenciaUseCase, AsistenciaElegibilidadError } from "./CreateAsistenciaUseCase";
import { trustedClock } from "../../../config/trusted-clock";
import { randomUUID } from "crypto";

/**
 * Hueco medido el 10-08-2026 en `asistencia, aforo, pausa y salida`.
 *
 * El caso de uso remoto creaba la asistencia sin preguntar nada, y el
 * controlador solo miraba pausa y pago pendiente —con distinta redacción que el
 * escritorio—. No miraba la cuota vencida ni si el socio ya estaba dentro: desde
 * el navegador se podía colar a un moroso y contarlo dos veces en el aforo.
 *
 * Esta prueba camina la regla contra MariaDB de verdad, no contra un doble: el
 * defecto estaba justo en lo que nadie leía de la base.
 */
describe("asistencia remota · la web aplica la misma regla que el mostrador", () => {
  const gymId = "local-gym-001";
  const CI = "AER000000001";
  const PLAN_ID = "aer-plan";

  let nationalityId = "";
  let currencyId = "";

  const crear = () =>
    new CreateAsistenciaUseCase(new PrismaAsistenciaRepository()).execute(
      { ci: CI } as any,
      gymId,
    );

  async function limpiar() {
    const membresias = await prisma.membresiaCliente.findMany({ where: { ci: CI } });
    for (const m of membresias) {
      await prisma.membresiaCuota.deleteMany({ where: { membresia_id: m.membresia_id } });
    }
    await prisma.membresiaCliente.deleteMany({ where: { ci: CI } });
    await prisma.asistencia.deleteMany({ where: { ci: CI } });
    await prisma.cliente.deleteMany({ where: { ci: CI } });
    await prisma.planesPago.deleteMany({ where: { id_planes_pago: PLAN_ID } });
  }

  /** Deja al socio con una única membresía en el estado pedido. */
  async function conMembresia(estado: string, opciones: { cuotaVencida?: boolean } = {}) {
    await prisma.membresiaCuota.deleteMany({
      where: { membresia_id: { in: (await prisma.membresiaCliente.findMany({
        where: { ci: CI }, select: { membresia_id: true },
      })).map((m) => m.membresia_id) } },
    });
    await prisma.membresiaCliente.deleteMany({ where: { ci: CI } });
    await prisma.asistencia.deleteMany({ where: { ci: CI } });

    const now = trustedClock.nowUtc();
    const membresiaId = randomUUID();
    await prisma.membresiaCliente.create({
      data: {
        membresia_id: membresiaId,
        ci: CI,
        id_planes_pago: PLAN_ID,
        plan_nombre_snapshot: "Plan de la prueba de entrada",
        precio_snapshot: 30,
        moneda_id: currencyId,
        duracion_dias_snapshot: 30,
        fecha_inicio: new Date(now.getTime() - 10 * 86400000),
        fecha_fin: new Date(now.getTime() + 20 * 86400000),
        estado,
        origen: "ALTA",
        importe_pagado: estado === "PENDIENTE_PAGO" ? 0 : 30,
        activada_at: estado === "ACTIVA" ? now : null,
        is_deleted: false,
        gym_id: gymId,
        version: 1,
        created_at: now,
        updated_at: now,
      } as any,
    });

    if (opciones.cuotaVencida) {
      // Cuota que cubre HOY y lleva días exigible sin pagar: es la que la
      // política de mora marca como bloqueante.
      await prisma.membresiaCuota.create({
        data: {
          cuota_instancia_id: randomUUID(),
          membresia_id: membresiaId,
          numero_cuota: 1,
          importe: 10,
          estado: "PENDIENTE",
          fecha_exigible: new Date(now.getTime() - 9 * 86400000),
          fecha_cobertura_inicio: new Date(now.getTime() - 9 * 86400000),
          fecha_cobertura_fin: new Date(now.getTime() + 20 * 86400000),
          fecha_pagada: null,
          dias_cobertura: 30,
          pago_detalle_id: null,
          is_deleted: false,
          gym_id: gymId,
          version: 1,
          created_at: now,
          updated_at: now,
        } as any,
      });
    }
    return membresiaId;
  }

  beforeAll(async () => {
    await limpiar();
    const [nationality, currency] = await Promise.all([
      prisma.nacionalidad.findFirst({ where: { is_deleted: false }, orderBy: { nacionalidad_id: "asc" } }),
      prisma.moneda.findFirst({ where: { codigo: "CUP", is_deleted: false } }),
    ]);
    if (!nationality || !currency) throw new Error("Faltan catálogos base (nacionalidad/CUP).");
    nationalityId = nationality.nacionalidad_id;
    currencyId = currency.moneda_id;

    const now = trustedClock.nowUtc();
    await prisma.planesPago.create({
      data: {
        id_planes_pago: PLAN_ID,
        nombre_plan_pago: "Plan de la prueba de entrada",
        importe_plan_pago: 30,
        duracion_plan_pago: 30,
        moneda_id: currencyId,
        activo: true,
        is_deleted: false,
        gym_id: gymId,
        version: 1,
        created_at: now,
        updated_at: now,
      } as any,
    });
    await prisma.cliente.create({
      data: {
        ci: CI, tipo_documento: "OTRO", nombres: "Socio", apellidos: "De Entrada",
        sexo: "Masculino", estatura_cliente: 180, nacionalidad_id: nationalityId,
        id_planes_pago: PLAN_ID, fecha_inicio: now,
        fecha_fin: new Date(now.getTime() + 30 * 86400000),
        activo: true, categoria: "NUEVO", is_deleted: false, gym_id: gymId,
        version: 1, created_at: now, updated_at: now,
      } as any,
    });
  });

  afterAll(async () => {
    await limpiar();
  });

  test("membresía ACTIVA sin cuotas: entra", async () => {
    await conMembresia("ACTIVA");
    const { asistencia, creada } = await crear();
    expect(creada).toBeTrue();
    expect(asistencia.ci).toBe(CI);
    expect(asistencia.gym_id).toBe(gymId);
  });

  test("marcar dos veces no crea una segunda visita ni cuenta doble en el aforo", async () => {
    await conMembresia("ACTIVA");
    const primera = await crear();
    const segunda = await crear();

    expect(primera.creada).toBeTrue();
    expect(segunda.creada).toBeFalse();
    expect(segunda.asistencia.asistencia_id).toBe(primera.asistencia.asistencia_id);

    const abiertas = await prisma.asistencia.count({
      where: { ci: CI, gym_id: gymId, fecha_salida: null, is_deleted: false },
    });
    expect(abiertas).toBe(1);
  });

  test("membresía PAUSADA: 409, y con el mismo texto que el escritorio", async () => {
    await conMembresia("PAUSADA");
    let capturado: any = null;
    try {
      await crear();
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(AsistenciaElegibilidadError);
    expect(capturado.status).toBe(409);
    expect(capturado.message).toBe(
      "La membresía está pausada. Reanúdela antes de registrar la entrada.",
    );
    expect(await prisma.asistencia.count({ where: { ci: CI } })).toBe(0);
  });

  test("membresía PENDIENTE_PAGO: 409 y no se registra nada", async () => {
    await conMembresia("PENDIENTE_PAGO");
    let capturado: any = null;
    try {
      await crear();
    } catch (error) {
      capturado = error;
    }
    expect(capturado?.status).toBe(409);
    expect(capturado.message).toBe(
      "La membresía está pendiente de pago. Registre el cobro antes de permitir la entrada.",
    );
    expect(await prisma.asistencia.count({ where: { ci: CI } })).toBe(0);
  });

  test("ACTIVA con la cuota vencida: 409 — este caso la web no lo miraba", async () => {
    await conMembresia("ACTIVA", { cuotaVencida: true });
    let capturado: any = null;
    try {
      await crear();
    } catch (error) {
      capturado = error;
    }
    expect(capturado?.status).toBe(409);
    expect(String(capturado.message).length).toBeGreaterThan(0);
    expect(await prisma.asistencia.count({ where: { ci: CI } })).toBe(0);
  });
});
