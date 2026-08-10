import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { PrismaClienteRepository } from "../../../infrastructure/repositories/PrismaClienteRepository";
import { UpdateClienteUseCase } from "./UpdateClienteUseCase";
import { CLIENTE_PROYECCIONES_NO_PERSISTIDAS } from "../sync/sync-event-contract";
import { trustedClock } from "../../../config/trusted-clock";

/**
 * Defecto del 10-08-2026: un socio editado desde la WEB no llegaba al
 * escritorio.
 *
 * `UpdateClienteUseCase` registraba el evento con `{...updated}`, y `updated`
 * sale de `findById`, que devuelve la ficha con la membresía vigente proyectada
 * encima. Esas ocho claves `membresia_*` no son columnas de `cliente`: el
 * escritorio se las pasaba a Prisma tal cual y este las rechazaba con «Unknown
 * argument `membresia_id`». El evento quedaba en cuarentena —no se perdía— y
 * las dos bases divergían en ese socio hasta que alguien mirara.
 *
 * La prueba pasa por `findById` de verdad, con una membresía viva, porque el
 * defecto vive justo ahí: en lo que la lectura añade y la escritura no admite.
 * Un doble del repositorio no lo habría visto nunca.
 */
describe("cliente · el evento de sync no lleva proyecciones de lectura", () => {
  const gymId = "local-gym-001";
  const CI = "CSP000000001";
  const PLAN_ID = "csp-plan";
  const MEMBRESIA_ID = "csp-membresia";

  let nationalityId = "";
  let currencyId = "";

  async function wipe() {
    await prisma.membresiaCliente.deleteMany({ where: { ci: CI } });
    await prisma.cliente.deleteMany({ where: { ci: CI } });
    await prisma.planesPago.deleteMany({ where: { id_planes_pago: PLAN_ID } });
  }

  beforeAll(async () => {
    await wipe();
    const nationality = await prisma.nacionalidad.findFirst({
      where: { is_deleted: false },
      orderBy: { nacionalidad_id: "asc" },
    });
    const currency = await prisma.moneda.findFirst({
      where: { codigo: "CUP", is_deleted: false },
    });
    if (!nationality || !currency) {
      throw new Error("Faltan catálogos base (nacionalidad/CUP) en la base remota.");
    }
    nationalityId = nationality.nacionalidad_id;
    currencyId = currency.moneda_id;

    const now = trustedClock.nowUtc();
    await prisma.planesPago.create({
      data: {
        id_planes_pago: PLAN_ID,
        nombre_plan_pago: "Plan de la prueba de proyecciones",
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
        ci: CI,
        tipo_documento: "OTRO",
        nombres: "Socio",
        apellidos: "De Proyección",
        sexo: "Femenino",
        estatura_cliente: 170,
        nacionalidad_id: nationalityId,
        id_planes_pago: PLAN_ID,
        fecha_inicio: now,
        fecha_fin: new Date(now.getTime() + 30 * 86400000),
        activo: true,
        categoria: "NUEVO",
        is_deleted: false,
        gym_id: gymId,
        version: 1,
        created_at: now,
        updated_at: now,
      } as any,
    });
    // Con membresía viva `findById` sí rellena las proyecciones; sin ella
    // llegarían todas nulas y la prueba pasaría sin comprobar nada.
    await prisma.membresiaCliente.create({
      data: {
        membresia_id: MEMBRESIA_ID,
        ci: CI,
        id_planes_pago: PLAN_ID,
        plan_nombre_snapshot: "Plan de la prueba de proyecciones",
        precio_snapshot: 30,
        moneda_id: currencyId,
        duracion_dias_snapshot: 30,
        fecha_inicio: now,
        fecha_fin: new Date(now.getTime() + 30 * 86400000),
        estado: "ACTIVA",
        origen: "ALTA",
        importe_pagado: 30,
        activada_at: now,
        is_deleted: false,
        gym_id: gymId,
        version: 1,
        created_at: now,
        updated_at: now,
      } as any,
    });
  });

  afterAll(async () => {
    await wipe();
  });

  test("findById sigue proyectando la membresía: el defecto tenía de dónde salir", async () => {
    const ficha = await new PrismaClienteRepository().findById(CI, gymId);
    expect(ficha?.membresia_id).toBe(MEMBRESIA_ID);
    expect(ficha?.membresia_estado).toBe("ACTIVA");
    expect(ficha?.membresia_vigencia).toBeTruthy();
  });

  test("el payload de `cliente/UPDATE` no lleva ninguna clave `membresia_*`", async () => {
    const registrados: any[] = [];
    const syncLogEspia = {
      async register(evento: any) {
        registrados.push(evento);
      },
    } as any;

    await new UpdateClienteUseCase(
      new PrismaClienteRepository(),
      syncLogEspia,
    ).execute(CI, { telefono: 55512345 } as any, gymId, {
      userId: null,
      role: "admin",
    });

    const evento = registrados.find(
      (e) => e.entidad === "cliente" && e.operacion === "UPDATE",
    );
    expect(evento).toBeDefined();
    for (const campo of CLIENTE_PROYECCIONES_NO_PERSISTIDAS) {
      expect(Object.keys(evento.payload)).not.toContain(campo);
    }
    // Y lo que sí es columna sigue viajando: la corrección quita proyecciones,
    // no campos editables. Este es el otro medio defecto posible.
    expect(evento.payload.ci).toBe(CI);
    expect(Number(evento.payload.telefono)).toBe(55512345);
    expect(evento.payload.categoria).toBe("NUEVO");
    expect(evento.payload.nacionalidad_codigo_iso).toBeTruthy();
  });
});
