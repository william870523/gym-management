import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { prisma } from "../../db/prismaClient";
import { getVisitanteEnVivo } from "./visitante-vivo.controller";

/**
 * §5.2 — la consulta viva tiene que responder con **lo que hay ahora**.
 *
 * El defecto que fija esta prueba se midió el 20-08-2026 contra los datos de
 * verdad: `cliente_visitante` daba la cobertura por terminada el 23/09/2026 y la
 * membresía del socio decía 20/06/2027. La copia se proyecta al marcar el plus y
 * al cobrarlo, y **nada la vuelve a tocar**; responder desde ella convertía esta
 * consulta en una foto vieja con nombre de dato fresco, y con eso se decide
 * quién entra.
 *
 * Va contra MariaDB porque el defecto estaba justo en de qué tabla se leía: un
 * doble habría respondido lo que yo le hubiera puesto.
 */
describe("consulta viva del visitante · responde la membresía, no la copia", () => {
  const CI = "CVV000000001";
  const ORIGEN = "dtc-gym-ajeno";
  const VISITADA = "local-gym-001";

  /** Contexto de hono mínimo: sesión del dispositivo, parámetro y `json`. */
  const contexto = (gymId: string) => {
    const salida: { body?: any; status?: number } = {};
    return {
      c: {
        get: () => ({ gymId }),
        req: { param: () => CI },
        json: (body: any, status?: number) => {
          salida.body = body;
          salida.status = status ?? 200;
          return salida;
        },
      } as any,
      salida,
    };
  };

  async function limpiar() {
    await prisma.membresiaCliente.deleteMany({ where: { ci: CI } });
    await prisma.clienteAccesoMultisede.deleteMany({ where: { ci: CI } });
    await prisma.clienteVisitante.deleteMany({ where: { ci: CI } });
    await prisma.cliente.deleteMany({ where: { ci: CI } });
  }

  const COPIA_VIEJA = new Date(Date.UTC(2026, 8, 23));
  const RENOVADA = new Date(Date.UTC(2027, 5, 20));

  beforeAll(async () => {
    await limpiar();
    const now = new Date();
    const nacionalidad = (await prisma.nacionalidad.findFirst())!.nacionalidad_id;
    const plan = (await prisma.planesPago.findFirst({
      where: { gym_id: ORIGEN },
    })) ?? (await prisma.planesPago.findFirst());

    await prisma.cliente.create({
      data: {
        ci: CI,
        tipo_documento: "OTRO",
        nombres: "Visita",
        apellidos: "Renovada",
        sexo: "Femenino",
        estatura_cliente: 165,
        nacionalidad_id: nacionalidad,
        id_planes_pago: plan!.id_planes_pago,
        fecha_inicio: now,
        fecha_fin: RENOVADA,
        activo: true,
        categoria: "NUEVO",
        is_deleted: false,
        gym_id: ORIGEN,
        version: 1,
        created_at: now,
        updated_at: now,
      } as any,
    });

    // La membresía de verdad, en la sede del socio: renovada hasta 2027.
    await prisma.membresiaCliente.create({
      data: {
        membresia_id: randomUUID(),
        ci: CI,
        id_planes_pago: plan!.id_planes_pago,
        plan_nombre_snapshot: "Plan de la prueba de consulta viva",
        precio_snapshot: 30,
        moneda_id: plan!.moneda_id,
        duracion_dias_snapshot: 30,
        fecha_inicio: now,
        fecha_fin: RENOVADA,
        estado: "ACTIVA",
        origen: "ALTA",
        importe_pagado: 30,
        activada_at: now,
        is_deleted: false,
        gym_id: ORIGEN,
        version: 1,
        created_at: now,
        updated_at: now,
      } as any,
    });

    // La copia, con la foto de cuando se pagó el plus: septiembre de 2026.
    await prisma.clienteVisitante.create({
      data: {
        ci: CI,
        gym_id_origen: ORIGEN,
        nombres: "Visita",
        apellidos: "Renovada",
        tipo_documento: "OTRO",
        membresia_estado: "ACTIVA",
        membresia_fecha_fin: COPIA_VIEJA,
        is_deleted: false,
      } as any,
    });

    await prisma.clienteAccesoMultisede.create({
      data: {
        cliente_acceso_multisede_id: randomUUID(),
        ci: CI,
        gym_id: ORIGEN,
        activo: true,
        vigente_hasta: RENOVADA,
        precio_snapshot: 0,
        moneda_id: plan!.moneda_id,
        marcado_por_user_id: "cvv-user",
        marcado_en_gym_id: ORIGEN,
        is_deleted: false,
      } as any,
    });
  });

  afterAll(async () => {
    await limpiar();
  });

  test("da la cobertura renovada, no la que guardó la copia", async () => {
    const { c, salida } = contexto(VISITADA);
    await getVisitanteEnVivo(c);

    expect(salida.status).toBe(200);
    expect(salida.body.existe).toBe(true);
    expect(new Date(salida.body.membresia_fecha_fin).toISOString()).toBe(
      RENOVADA.toISOString(),
    );
    // Y lo que se responde NO es lo que dice la copia, que sigue igual: esta
    // consulta no la corrige, solo deja de creérsela. Ponerla al día es del
    // barrido, que es quien puede emitir el evento para todas las sedes.
    const copia = await prisma.clienteVisitante.findUnique({ where: { ci: CI } });
    expect(copia!.membresia_fecha_fin!.toISOString()).toBe(
      COPIA_VIEJA.toISOString(),
    );
  });

  test("la identidad y la sede dueña siguen saliendo de la copia", async () => {
    // Es lo que la copia sí sabe, y lo que hace falta para acotar la respuesta.
    const { c, salida } = contexto(VISITADA);
    await getVisitanteEnVivo(c);

    expect(salida.body.gym_id_origen).toBe(ORIGEN);
    expect(salida.body.membresia_estado).toBe("ACTIVA");
  });

  test("dice de cuándo es: la última noticia de la sede del socio", async () => {
    // Sin esto, quien pregunta da por comprobado lo que le contestan. El
    // concentrador no inventa el estado del visitante: lo sabe porque su sede
    // lo subió, y si esa lleva días muda la respuesta es una foto vieja.
    const { c, salida } = contexto(VISITADA);
    await getVisitanteEnVivo(c);

    expect(salida.body).toHaveProperty("sede_origen_ultima_noticia");
    // Se responde el instante, no una clasificación en días: el mostrador la
    // hace contra SU día de negocio, que puede no ser el del concentrador.
    const noticia = salida.body.sede_origen_ultima_noticia;
    expect(noticia === null || !Number.isNaN(Date.parse(noticia))).toBeTrue();
  });

  test("una sede no pregunta por sus propios socios", async () => {
    // Para esos tiene la ficha; contestar aquí sería un camino paralelo al de
    // la puerta de casa, y dos caminos acaban diciendo cosas distintas.
    const { c, salida } = contexto(ORIGEN);
    await getVisitanteEnVivo(c);

    expect(salida.status).toBe(409);
  });
});
