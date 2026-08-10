import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { app } from "../server";
import { JwtService } from "../../auth/jwt.service";
import { prisma } from "../../db/prismaClient";
import { RemoteMembershipTrainerChangeService } from "../../../application/membership/trainer-change.service";

/**
 * R5.4 · Unidad 08 — rutas remotas del cambio de entrenador.
 *
 * Lo que fija esta prueba, además del camino feliz:
 *
 *  - **recepción ejecuta el cambio sin aprobación previa** (regla del dueño):
 *    si algún día alguien mete un `esAdmin` en esa ruta, esto lo tumba;
 *  - **la bandeja de avisos es de administración**, y recepción recibe 403;
 *  - **una membresía de otra sede responde 404**, no 403 ni datos: el error no
 *    debe filtrar que la membresía existe en algún sitio;
 *  - **leer no borra**: el aviso cambia de estado y sigue en el historial;
 *  - **marcar leído es idempotente**.
 *
 * Siembra sus propios datos, incluida una segunda sede, y los retira al
 * terminar. No depende de ninguna fixture instalada.
 */
describe("Rutas de cambio de entrenador (Remote)", () => {
  const GYM = "local-gym-001";
  const GYM_AJENO = "tcr-gym-ajeno";
  const CI = "TCR000000001";
  const PLAN = "d1d1d1d1-1111-4111-8111-d1d1d1d1d1d1";
  const MEM = "e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2";
  const TRAINER_A = "f3f3f3f3-3333-4333-8333-f3f3f3f3f3f3";
  const TRAINER_B = "a4a4a4a4-4444-4444-8444-a4a4a4a4a4a4";
  const TRAINER_INACTIVO = "b5b5b5b5-5555-4555-8555-b5b5b5b5b5b5";
  const USER_AJENO = "tcr-user-ajeno";

  let tokenAdmin = "";
  let tokenRecepcion = "";
  let tokenAjeno = "";
  let monedaId = "";

  const dia = (offset: number) => {
    const hoy = new Date();
    return new Date(
      Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) +
        offset * 86_400_000,
    );
  };

  const enviar = (metodo: string, ruta: string, token: string, body: unknown = {}) =>
    app.request(ruta, {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  const leer = (ruta: string, token: string) =>
    app.request(ruta, { headers: { Authorization: `Bearer ${token}` } });

  async function limpiar() {
    await prisma.avisoAdministracion.deleteMany({ where: { referencia_id: MEM } });
    await prisma.membresiaEntrenadorAsignacion.deleteMany({ where: { membresia_id: MEM } });
    await prisma.membresiaCliente.deleteMany({ where: { membresia_id: MEM } });
    await prisma.cliente.deleteMany({ where: { ci: CI } });
    await prisma.planesPago.deleteMany({ where: { id_planes_pago: PLAN } });
    await prisma.entrenador.deleteMany({
      where: { id_entrenador: { in: [TRAINER_A, TRAINER_B, TRAINER_INACTIVO] } },
    });
    await prisma.usuarioSede.deleteMany({ where: { user_id: USER_AJENO } });
    await prisma.user.deleteMany({ where: { user_id: USER_AJENO } });
    await prisma.gym.deleteMany({ where: { gym_id: GYM_AJENO } });
    // Esta prueba ejecuta cambios REALES, y un cambio real emite `sync_log`.
    // Si el rastro sobrevive a las filas, cualquier dispositivo con el cursor
    // atrasado se descarga avisos y asignaciones de una membresía que ya no
    // existe: pasó el 01-08-2026 y dejó nueve filas huérfanas en el escritorio.
    // Quien borra el dato borra su rastro, en la misma limpieza.
    const rastro = await prisma.syncLog.findMany({
      where: {
        OR: [
          { entidad_id: { in: [MEM, CI, TRAINER_A, TRAINER_B, TRAINER_INACTIVO, PLAN] } },
          { entidad: "aviso_administracion", payload_json: { contains: MEM } },
          { entidad: "membresia_entrenador_asignacion", payload_json: { contains: MEM } },
        ],
      },
      select: { id: true },
    });
    if (rastro.length) {
      await prisma.syncLog.deleteMany({ where: { id: { in: rastro.map((r) => r.id) } } });
    }
  }

  beforeAll(async () => {
    await limpiar();

    const moneda = await prisma.moneda.findFirst({ where: { codigo: "CUP", is_deleted: false } });
    const nacionalidad = await prisma.nacionalidad.findFirst({ where: { is_deleted: false } });
    if (!moneda || !nacionalidad) throw new Error("Faltan catálogos base.");
    monedaId = moneda.moneda_id;

    // Sede ajena, para probar el aislamiento de verdad y no de mentira.
    await prisma.gym.create({
      data: {
        gym_id: GYM_AJENO,
        codigo: "TCR-AJENO",
        nombre: "Sede ajena (prueba R5.4)",
        timezone: "Etc/UTC",
        activo: true,
      },
    });
    await prisma.user.create({
      data: {
        user_id: USER_AJENO,
        user_nombre: "Admin de la sede ajena",
        user_email: "tcr.ajeno@gym.test",
        password: "SIN-CLAVE",
        role: "admin",
        active: true,
        is_deleted: false,
        gym_id: GYM_AJENO,
      },
    });
    // Sin la asignación de sede, el middleware corta con 404 «Gym not found»
    // antes de llegar a la ruta: pedir una sede donde no se trabaja se responde
    // como si no existiera (docs/MULTI_SEDE.md §3.3). La prueba quiere el otro
    // 404, el de la membresía ajena, así que la sesión tiene que ser válida.
    await prisma.usuarioSede.create({
      data: {
        usuario_sede_id: `us-${USER_AJENO}`,
        user_id: USER_AJENO,
        gym_id: GYM_AJENO,
        rol: "admin",
        activo: true,
        is_deleted: false,
      },
    });

    for (const [id, nombre, activo] of [
      [TRAINER_A, "Ana", true],
      [TRAINER_B, "Beto", true],
      [TRAINER_INACTIVO, "Ceci", false],
    ] as Array<[string, string, boolean]>) {
      await prisma.entrenador.create({
        data: {
          id_entrenador: id,
          ci_entrenador: `TCR-ENT-${nombre}`,
          nombres_entrenador: nombre,
          apellidos_entrenador: "Prueba R5.4",
          sexo_entrenador: "Femenino",
          fecha_incio_entrenador: dia(-100),
          activo_entrenador: activo,
          is_deleted: false,
          gym_id: GYM,
        },
      });
    }

    await prisma.planesPago.create({
      data: {
        id_planes_pago: PLAN,
        nombre_plan_pago: "Plan trimestral prueba R5.4",
        importe_plan_pago: 300,
        duracion_plan_pago: 90,
        moneda_id: monedaId,
        activo: true,
        gym_id: GYM,
      },
    });
    await prisma.cliente.create({
      data: {
        ci: CI,
        nombres: "Socio",
        apellidos: "Cambio Entrenador",
        sexo: "Masculino",
        estatura_cliente: 1.8,
        nacionalidad_id: nacionalidad.nacionalidad_id,
        fecha_inicio: dia(-45),
        fecha_fin: dia(45),
        activo: true,
        id_entrenador: TRAINER_A,
        gym_id: GYM,
      },
    });
    await prisma.membresiaCliente.create({
      data: {
        membresia_id: MEM,
        ci: CI,
        id_planes_pago: PLAN,
        plan_nombre_snapshot: "Plan trimestral prueba R5.4",
        precio_snapshot: 300,
        moneda_id: monedaId,
        duracion_dias_snapshot: 90,
        fecha_inicio: dia(-45),
        fecha_fin: dia(45),
        estado: "ACTIVA",
        origen: "ALTA",
        id_entrenador: TRAINER_A,
        activada_at: dia(-45),
        gym_id: GYM,
      },
    });
    await prisma.membresiaEntrenadorAsignacion.create({
      data: {
        asignacion_id: `${MEM}-asig-1`,
        membresia_id: MEM,
        id_entrenador: TRAINER_A,
        fecha_inicio: dia(-45),
        estado: "ACTIVA",
        is_deleted: false,
        gym_id: GYM,
      },
    });

    const admin = await prisma.user.findFirst({
      where: { gym_id: GYM, active: true, is_deleted: false, role: "admin" },
    });
    const recepcion = await prisma.user.findFirst({
      where: { gym_id: GYM, active: true, is_deleted: false, role: { not: "admin" } },
    });
    if (!admin || !recepcion) {
      throw new Error("La prueba exige un admin y un no-admin en el gimnasio.");
    }
    tokenAdmin = JwtService.signAdminToken({ userId: admin.user_id, role: admin.role, gymId: GYM });
    tokenRecepcion = JwtService.signAdminToken({
      userId: recepcion.user_id, role: recepcion.role, gymId: GYM,
    });
    tokenAjeno = JwtService.signAdminToken({
      userId: USER_AJENO, role: "admin", gymId: GYM_AJENO,
    });
  });

  afterAll(async () => {
    await limpiar();
  });

  test("una membresía de otra sede responde 404, sin filtrar que existe", async () => {
    const res = await enviar("POST", `/membresias/${MEM}/cambiar-entrenador`, tokenAjeno, {
      nuevo_entrenador_id: TRAINER_B,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("La membresía no existe.");
  });

  test("el entrenador destino inactivo responde 404", async () => {
    const res = await enviar("POST", `/membresias/${MEM}/cambiar-entrenador`, tokenRecepcion, {
      nuevo_entrenador_id: TRAINER_INACTIVO,
    });

    expect(res.status).toBe(404);
  });

  test("el entrenador destino igual al actual responde 409", async () => {
    const res = await enviar("POST", `/membresias/${MEM}/cambiar-entrenador`, tokenRecepcion, {
      nuevo_entrenador_id: TRAINER_A,
    });

    expect(res.status).toBe(409);
  });

  test("una membresía inexistente responde 404", async () => {
    const res = await enviar(
      "POST", "/membresias/00000000-0000-4000-8000-000000000000/cambiar-entrenador",
      tokenRecepcion, { nuevo_entrenador_id: TRAINER_B },
    );

    expect(res.status).toBe(404);
  });

  test("recepción ejecuta el cambio sin aprobación previa y deja un aviso", async () => {
    const res = await enviar("POST", `/membresias/${MEM}/cambiar-entrenador`, tokenRecepcion, {
      nuevo_entrenador_id: TRAINER_B,
      motivo: "El socio lo pidió en recepción",
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.entrenador_anterior).toBe("Ana Prueba R5.4");
    expect(body.entrenador_nuevo).toBe("Beto Prueba R5.4");
    expect(body.aviso_id).toBeTruthy();

    // La asignación vieja se cierra y nace la nueva; el dinero pasado no se toca.
    const asignaciones = await prisma.membresiaEntrenadorAsignacion.findMany({
      where: { membresia_id: MEM },
      orderBy: { fecha_inicio: "asc" },
    });
    expect(asignaciones.map((a) => a.estado)).toEqual(["CERRADA", "ACTIVA"]);

    // El aviso nace exactamente una vez, y con el ejecutor revalidado en base.
    const avisos = await prisma.avisoAdministracion.findMany({
      where: { referencia_id: MEM, tipo: "CAMBIO_ENTRENADOR" },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.leido).toBe(false);
    expect(avisos[0]!.actor_nombre).toBeTruthy();

    // Y el cambio viaja: sin evento, el escritorio nunca se entera.
    const eventos = await prisma.syncLog.findMany({
      where: { entidad: "aviso_administracion", entidad_id: avisos[0]!.aviso_id },
    });
    expect(eventos.length).toBeGreaterThanOrEqual(1);
  });

  test("recepción no puede leer la bandeja de avisos", async () => {
    const res = await leer("/avisos-administracion", tokenRecepcion);

    expect(res.status).toBe(403);
  });

  test("administración ve el aviso pendiente", async () => {
    const res = await leer("/avisos-administracion", tokenAdmin);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.some((a: any) => a.referencia_id === MEM)).toBe(true);
  });

  test("marcar leído no borra el aviso y es idempotente", async () => {
    const aviso = await prisma.avisoAdministracion.findFirst({ where: { referencia_id: MEM } });
    const primera = await enviar("POST", "/avisos-administracion/leer", tokenAdmin, {
      aviso_ids: [aviso!.aviso_id],
    });
    const segunda = await enviar("POST", "/avisos-administracion/leer", tokenAdmin, {
      aviso_ids: [aviso!.aviso_id],
    });

    expect(await primera.json()).toEqual({ marcados: 1 });
    // Idempotente: repetir no falla y no vuelve a contar.
    expect(await segunda.json()).toEqual({ marcados: 0 });

    // Leer NO borra: sigue en el historial, solo cambió de estado.
    const guardado = await prisma.avisoAdministracion.findUnique({
      where: { aviso_id: aviso!.aviso_id },
    });
    expect(guardado).not.toBeNull();
    expect(guardado!.leido).toBe(true);

    const historial = await leer("/avisos-administracion?leidos=todos", tokenAdmin);
    const body = await historial.json();
    expect(body.some((a: any) => a.aviso_id === aviso!.aviso_id)).toBe(true);
  });

  test("si falla la creación del aviso, el cambio entero se revierte", async () => {
    // El manual lo pide como prueba obligatoria, y no basta con que el aviso
    // nazca «dentro de la transacción»: hay que forzar el fallo y comprobar que
    // no queda un cambio sin su aviso. Un socio reasignado del que
    // administración nunca se entera es peor que un cambio que no ocurrió.
    const antes = await prisma.membresiaCliente.findUnique({
      where: { membresia_id: MEM },
      select: { id_entrenador: true },
    });
    const asignacionesAntes = await prisma.membresiaEntrenadorAsignacion.count({
      where: { membresia_id: MEM },
    });
    const avisosAntes = await prisma.avisoAdministracion.count({
      where: { referencia_id: MEM },
    });

    const servicio = new RemoteMembershipTrainerChangeService();
    const destino =
      antes!.id_entrenador === TRAINER_A ? TRAINER_B : TRAINER_A;

    let motivoDelFallo = "";
    try {
      await prisma.$transaction(async (tx) => {
        // Mismo `tx` en todo salvo en la creación del aviso, que revienta.
        const saboteado = new Proxy(tx, {
          get(objetivo, propiedad) {
            if (propiedad === "avisoAdministracion") {
              return {
                ...(objetivo as any).avisoAdministracion,
                create: async () => {
                  throw new Error("fallo simulado al crear el aviso");
                },
              };
            }
            return (objetivo as any)[propiedad];
          },
        });
        await servicio.change(saboteado as any, {
          gymId: GYM,
          membershipId: MEM,
          newTrainerId: destino,
          reason: "Prueba de rollback",
          userId: (await prisma.user.findFirst({
            where: { gym_id: GYM, active: true, is_deleted: false, role: "admin" },
          }))!.user_id,
        });
      });
    } catch (error: any) {
      motivoDelFallo = String(error?.message ?? error);
    }

    // Que reviente NO basta: si hubiera fallado antes —por validación, por
    // ejemplo— la prueba pasaría en vacío sin haber ejercitado el rollback.
    // Se exige que el fallo sea EL del aviso, es decir que el servicio llegó
    // hasta ahí después de haber escrito la asignación y la membresía.
    expect(motivoDelFallo).toContain("fallo simulado al crear el aviso");
    // Y nada quedó a medias: ni el entrenador movido, ni una asignación
    // huérfana, ni un aviso suelto.
    const despues = await prisma.membresiaCliente.findUnique({
      where: { membresia_id: MEM },
      select: { id_entrenador: true },
    });
    expect(despues!.id_entrenador).toBe(antes!.id_entrenador);
    expect(
      await prisma.membresiaEntrenadorAsignacion.count({ where: { membresia_id: MEM } }),
    ).toBe(asignacionesAntes);
    expect(
      await prisma.avisoAdministracion.count({ where: { referencia_id: MEM } }),
    ).toBe(avisosAntes);
  });

  test("sin token no se puede cambiar el entrenador", async () => {
    const res = await app.request(`/membresias/${MEM}/cambiar-entrenador`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(401);
  });

  // H4 (regresión, 03-08-2026): si el operador deja el motivo en blanco, el
  // sistema no debe inventar "Cambio a petición del cliente". La asignación que
  // se cierra queda con motivo_cierre en null y el expediente no pintará la
  // línea ↳, igual que el aviso no pinta "Motivo:". Escenario propio aislado.
  test("un cambio sin motivo no inventa el texto «a petición del cliente»", async () => {
    const MEM2 = "e2e2e2e2-2222-4222-8222-h4h4h4h4h4h4";
    const CI2 = "TCR000000H4";
    const ASIG_H4 = `${MEM2}-asig-1`;
    const NAC = await prisma.nacionalidad.findFirst();
    const syncBaseline = (await prisma.syncLog.aggregate({ _max: { id: true } }))._max.id ?? 0;
    try {
      await prisma.cliente.create({
        data: {
          ci: CI2,
          nombres: "Socio",
          apellidos: "Sin Motivo H4",
          sexo: "Masculino",
          estatura_cliente: 1.8,
          nacionalidad_id: NAC!.nacionalidad_id,
          fecha_inicio: dia(-45),
          fecha_fin: dia(45),
          activo: true,
          id_entrenador: TRAINER_A,
          gym_id: GYM,
        },
      });
      await prisma.membresiaCliente.create({
        data: {
          membresia_id: MEM2,
          ci: CI2,
          id_planes_pago: PLAN,
          plan_nombre_snapshot: "Plan H4",
          precio_snapshot: 300,
          moneda_id: monedaId,
          duracion_dias_snapshot: 90,
          fecha_inicio: dia(-45),
          fecha_fin: dia(45),
          estado: "ACTIVA",
          origen: "ALTA",
          id_entrenador: TRAINER_A,
          activada_at: dia(-45),
          gym_id: GYM,
        },
      });
      await prisma.membresiaEntrenadorAsignacion.create({
        data: {
          asignacion_id: ASIG_H4,
          membresia_id: MEM2,
          id_entrenador: TRAINER_A,
          fecha_inicio: dia(-45),
          estado: "ACTIVA",
          gym_id: GYM,
          is_deleted: false,
          version: 1,
          created_at: dia(-45),
          updated_at: dia(-45),
        },
      });

      // Cambio SIN motivo: el cuerpo no lleva `motivo`.
      const res = await enviar("POST", `/membresias/${MEM2}/cambiar-entrenador`, tokenRecepcion, {
        nuevo_entrenador_id: TRAINER_B,
      });
      expect(res.status).toBe(201);

      const cerrada = await prisma.membresiaEntrenadorAsignacion.findUnique({
        where: { asignacion_id: ASIG_H4 },
        select: { estado: true, motivo_cierre: true },
      });
      expect(cerrada!.estado).toBe("CERRADA");
      // Lo que fijaba esta prueba: nada de texto inventado.
      expect(cerrada!.motivo_cierre).toBeNull();
    } finally {
      const rastroH4 = await prisma.syncLog.findMany({
        where: {
          id: { gt: syncBaseline },
          OR: [
            { entidad_id: { in: [MEM2, CI2, ASIG_H4] } },
            { payload_json: { contains: MEM2 } },
          ],
        },
        select: { id: true },
      });

      await prisma.$transaction(async (tx) => {
        await tx.avisoAdministracion.deleteMany({ where: { referencia_id: MEM2 } });
        await tx.membresiaEntrenadorAsignacion.deleteMany({ where: { membresia_id: MEM2 } });
        await tx.membresiaCliente.deleteMany({ where: { membresia_id: MEM2 } });
        await tx.cliente.deleteMany({ where: { ci: CI2 } });
        if (rastroH4.length) {
          await tx.syncLog.deleteMany({ where: { id: { in: rastroH4.map((row) => row.id) } } });
        }
      });

      expect(
        await prisma.syncLog.count({ where: { id: { in: rastroH4.map((row) => row.id) } } }),
      ).toBe(0);
    }
  });
});
