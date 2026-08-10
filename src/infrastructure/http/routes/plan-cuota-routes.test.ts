import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { app } from "../server";
import { JwtService } from "../../auth/jwt.service";
import { prisma } from "../../db/prismaClient";

/**
 * R5.2 — endpoints de cuotas del remoto (docs/PLAN_INSTALLMENTS.md §4).
 *
 * El remoto no tenía ninguno: la ventana de cobro en web no podía saber qué
 * cuotas existían ni cuál tocaba, así que se quedaba sin ofrecer el pago por
 * cuotas —y en silencio, porque el diálogo se traga esos errores—.
 *
 * Lo que fija esta prueba, además del camino feliz:
 *  - recepción PUEDE leer (si no, no puede cobrar) pero NO definir el esquema;
 *  - todo va acotado por el gimnasio del token.
 *
 * Siembra sus propios datos para no importar módulos de fuera de `src`.
 */
describe("Rutas de cuotas (Remote)", () => {
  const gymId = "local-gym-001";
  const PLAN_ID = "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1";
  const MEM_ATRASO = "b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2";
  const MEM_ALDIA = "c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3";
  const CI = "PCR000000001";
  const PRECIO = 30;
  const CUOTA = 10;

  let tokenAdmin = "";
  let tokenRecepcion: string | null = null;
  let currencyId = "";

  /** Mismo id determinista que calcula PlanInstallmentService. */
  const cuotaId = (membershipId: string, numero: number) =>
    `mcuota-${createHash("sha256").update(`${membershipId}|${numero}`).digest("hex").slice(0, 24)}`;

  const utcDay = (offset: number) => {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
        offset * 86_400_000,
    );
  };

  const get = (ruta: string, token: string) =>
    app.request(ruta, { headers: { Authorization: `Bearer ${token}` } });

  const send = (metodo: string, ruta: string, token: string, body: unknown) =>
    app.request(ruta, {
      method: metodo,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

  async function wipe() {
    for (const memId of [MEM_ATRASO, MEM_ALDIA]) {
      await prisma.membresiaCuota.deleteMany({ where: { membresia_id: memId } });
      await prisma.membresiaEntrenadorAsignacion.deleteMany({
        where: { membresia_id: memId },
      });
      await prisma.membresiaCliente.deleteMany({ where: { membresia_id: memId } });
    }
    // Los esquemas los crea el endpoint con ids propios, así que hay que
    // leerlos ANTES de borrarlos: su evento se identifica por `esquema_id`, no
    // por el plan. Sin esto quedaban eventos apuntando a un plan inexistente y,
    // por el orden estricto, **bloqueaban la descarga de cualquier dispositivo**
    // (pasó de verdad el 26-07-2026: 60 eventos huérfanos parando la cola).
    const esquemas = await prisma.planCuotaEsquema.findMany({
      where: { plan_id: PLAN_ID },
      select: { esquema_id: true },
    });
    await prisma.planCuotaEsquema.deleteMany({ where: { plan_id: PLAN_ID } });
    await prisma.cliente.deleteMany({ where: { ci: CI } });
    await prisma.planesPago.deleteMany({ where: { id_planes_pago: PLAN_ID } });
    await prisma.syncLog.deleteMany({
      where: {
        entidad_id: {
          in: [
            PLAN_ID, MEM_ATRASO, MEM_ALDIA, CI,
            ...esquemas.map((row) => row.esquema_id),
            ...[1, 2, 3].flatMap((n) => [cuotaId(MEM_ATRASO, n), cuotaId(MEM_ALDIA, n)]),
          ],
        },
      },
    });
  }

  beforeAll(async () => {
    await wipe();

    const currency = await prisma.moneda.findFirst({
      where: { codigo: "CUP", is_deleted: false },
    });
    const nationality = await prisma.nacionalidad.findFirst({
      where: { is_deleted: false },
    });
    if (!currency || !nationality) throw new Error("Faltan catálogos base.");
    currencyId = currency.moneda_id;

    await prisma.planesPago.create({
      data: {
        id_planes_pago: PLAN_ID,
        nombre_plan_pago: "Plan de rutas de cuotas",
        importe_plan_pago: PRECIO,
        duracion_plan_pago: 30,
        moneda_id: currencyId,
        activo: true,
        gym_id: gymId,
        acepta_cuotas: true,
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
        apellidos: "Rutas Cuotas",
        sexo: "Masculino",
        estatura_cliente: 1.8,
        nacionalidad_id: nationality.nacionalidad_id,
        fecha_inicio: utcDay(-15),
        fecha_fin: utcDay(-5),
        activo: true,
        gym_id: gymId,
      },
    });

    // Dos membresías: una atrasada (cuota 2 vencida) y otra al día (cuota 2
    // aún no exigible, para que marcarla quede ANTICIPADA).
    for (const [memId, inicioOffset] of [
      [MEM_ATRASO, -15],
      [MEM_ALDIA, -5],
    ] as Array<[string, number]>) {
      await prisma.membresiaCliente.create({
        data: {
          membresia_id: memId,
          ci: CI,
          id_planes_pago: PLAN_ID,
          plan_nombre_snapshot: "Plan de rutas de cuotas",
          precio_snapshot: PRECIO,
          moneda_id: currencyId,
          duracion_dias_snapshot: 30,
          fecha_inicio: utcDay(inicioOffset),
          fecha_fin: utcDay(inicioOffset + 10),
          estado: "ACTIVA",
          origen: "ALTA",
          importe_pagado: CUOTA,
          activada_at: utcDay(inicioOffset),
          gym_id: gymId,
        },
      });
      for (const numero of [1, 2, 3]) {
        await prisma.membresiaCuota.create({
          data: {
            cuota_instancia_id: cuotaId(memId, numero),
            gym_id: gymId,
            membresia_id: memId,
            numero_cuota: numero,
            importe: CUOTA,
            dias_cobertura: 10,
            fecha_exigible: utcDay(inicioOffset + 10 * (numero - 1)),
            fecha_cobertura_inicio: utcDay(inicioOffset + 10 * (numero - 1)),
            fecha_cobertura_fin: utcDay(inicioOffset + 10 * numero),
            estado: numero === 1 ? "PAGADA" : "PENDIENTE",
            fecha_pagada: numero === 1 ? utcDay(inicioOffset) : null,
          },
        });
      }
    }

    const admin = await prisma.user.findFirst({
      where: { gym_id: gymId, active: true, is_deleted: false, role: "admin" },
    });
    if (!admin) throw new Error("Falta un usuario admin en el gimnasio de prueba.");
    tokenAdmin = JwtService.signAdminToken({
      userId: admin.user_id, role: admin.role, gymId,
    });

    const recepcion = await prisma.user.findFirst({
      where: {
        gym_id: gymId, active: true, is_deleted: false, role: { not: "admin" },
      },
    });
    tokenRecepcion = recepcion
      ? JwtService.signAdminToken({
          userId: recepcion.user_id, role: recepcion.role, gymId,
        })
      : null;
  });

  afterAll(async () => {
    await wipe();
  });

  test("devuelve el esquema de cuotas de un plan", async () => {
    const res = await get(`/planes-pago/${PLAN_ID}/cuotas`, tokenAdmin);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(3);
    expect(body[0].numeroCuota).toBe(1);
    expect(Number(body[0].importe)).toBe(CUOTA);
  });

  test("devuelve las cuotas materializadas de una membresía", async () => {
    const res = await get(`/membresias/${MEM_ATRASO}/cuotas`, tokenAdmin);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.map((row: any) => row.estado)).toEqual([
      "PAGADA", "PENDIENTE", "PENDIENTE",
    ]);
  });

  test("un plan que no es del gimnasio responde 404", async () => {
    const res = await get(
      "/planes-pago/11111111-1111-4111-8111-111111111111/cuotas",
      tokenAdmin,
    );

    expect(res.status).toBe(404);
  });

  test("una membresía que no es del gimnasio responde 404", async () => {
    const res = await get(
      "/membresias/22222222-2222-4222-8222-222222222222/cuotas",
      tokenAdmin,
    );

    expect(res.status).toBe(404);
  });

  test("recepción puede leer: sin esto no podría cobrar por cuotas", async () => {
    if (!tokenRecepcion) return;
    const esquema = await get(`/planes-pago/${PLAN_ID}/cuotas`, tokenRecepcion);
    const cuotas = await get(`/membresias/${MEM_ATRASO}/cuotas`, tokenRecepcion);

    expect(esquema.status).toBe(200);
    expect(cuotas.status).toBe(200);
  });

  test("recepción no puede definir el esquema", async () => {
    if (!tokenRecepcion) return;
    const res = await send(
      "PUT", `/planes-pago/${PLAN_ID}/cuotas`, tokenRecepcion,
      { tranches: [{ numeroCuota: 1, importe: "30.00", diasCobertura: 30 }] },
    );

    expect(res.status).toBe(403);
  });

  test("rechaza un esquema que no cuadra con el plan", async () => {
    const res = await send(
      "PUT", `/planes-pago/${PLAN_ID}/cuotas`, tokenAdmin,
      { tranches: [{ numeroCuota: 1, importe: "5.00", diasCobertura: 5 }] },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no coincide con la duración del plan/);
  });

  test("admin redefine el esquema y los tramos sobrantes se retiran", async () => {
    const res = await send(
      "PUT", `/planes-pago/${PLAN_ID}/cuotas`, tokenAdmin,
      {
        tranches: [
          { numeroCuota: 1, importe: "15.00", diasCobertura: 15 },
          { numeroCuota: 2, importe: "15.00", diasCobertura: 15 },
        ],
      },
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toHaveLength(2);
    // El tercer tramo queda borrado, no huérfano.
    const tercero = await prisma.planCuotaEsquema.findFirst({
      where: { plan_id: PLAN_ID, numero_cuota: 3 },
    });
    expect(tercero?.is_deleted).toBe(true);
  });

  test("marca una cuota como pagada", async () => {
    const res = await send(
      "POST", `/membresias/${MEM_ALDIA}/cuotas/2/pagar`, tokenAdmin, {},
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // Se paga antes de su fecha exigible, así que queda ANTICIPADA.
    expect(body.estado).toBe("ANTICIPADA");
  });

  test("sin token no se puede marcar una cuota", async () => {
    const res = await app.request(
      `/membresias/${MEM_ALDIA}/cuotas/3/pagar`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );

    expect(res.status).toBe(401);
  });
});
