import { Hono } from "hono";
import type { Context } from "hono";
import * as crypto from "crypto";
import { serialize } from "../../../shared/utils/serialize";
import { prisma } from "../../db/prismaClient";
import {
  PlanInstallmentService,
  PlanInstallmentServiceError,
} from "../../../application/membership/plan-installment.service";
import { PlanInstallmentPolicyError } from "../../../domain/plan-installment-policy";
import {
  RemoteMembershipTrainerChangeService,
  TrainerChangeError,
} from "../../../application/membership/trainer-change.service";
import { PaymentActorError } from "../../../application/payment/payment-actor";

/**
 * R5.2 — cuotas del cliente, lado remoto (docs/PLAN_INSTALLMENTS.md §4).
 *
 * Espejo de `gym-local-api/.../plan_cuota.routes.ts` con una diferencia que no
 * es cosmética: **todo va acotado por el gimnasio del token**. La versión local
 * puede consultar sin filtro porque su base sirve a una sola sede; aquí un plan
 * o una membresía de otro gimnasio debe responder 404, no devolver datos.
 */
export const planCuotaRoutes = new Hono();
const service = new PlanInstallmentService();
const trainerChanges = new RemoteMembershipTrainerChangeService();

/** Actor autenticado; el ámbito sale del token, nunca del cuerpo. */
function actor(c: Context) {
  const auth = (c as any).get("auth");
  return auth?.sub && auth.gymId
    ? { userId: auth.sub as string, gymId: auth.gymId as string, role: auth.role }
    : null;
}

function esAdmin(auth: { role?: unknown } | null) {
  return String(auth?.role ?? "").trim().toLowerCase() === "admin";
}

function fallo(c: Context, error: any) {
  // R5.4: los dos errores del cambio de entrenador traen su propio estado.
  // `PaymentActorError` incluye el 503 de «identidad no disponible», que no
  // debe degradarse a 400: distingue «no puedo comprobar quién eres» de «los
  // datos que enviaste están mal».
  if (error instanceof TrainerChangeError || error instanceof PaymentActorError) {
    return c.json({ error: error.message }, error.status as any);
  }
  if (error instanceof PlanInstallmentServiceError) {
    return c.json({ error: error.message }, error.status as any);
  }
  if (error instanceof PlanInstallmentPolicyError) {
    return c.json({ error: error.message }, 400);
  }
  return c.json({ error: error?.message ?? "No se pudo completar la operación." }, 400);
}

/** Esquema de cuotas de un plan. */
planCuotaRoutes.get("/planes-pago/:id/cuotas", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  const planId = c.req.param("id");
  try {
    const plan = await prisma.planesPago.findFirst({
      where: { id_planes_pago: planId, gym_id: auth.gymId, is_deleted: false },
      select: { id_planes_pago: true },
    });
    if (!plan) return c.json({ error: "El plan no existe en este gimnasio." }, 404);
    return c.json(await service.getScheme(prisma as any, auth.gymId, planId));
  } catch (error: any) {
    return fallo(c, error);
  }
});

/** Crea o reemplaza el esquema de cuotas de un plan (solo administración). */
planCuotaRoutes.put("/planes-pago/:id/cuotas", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  if (!esAdmin(auth)) {
    return c.json({ error: "Solo administración define el esquema de cuotas." }, 403);
  }
  const planId = c.req.param("id");
  try {
    const body = await c.req.json().catch(() => ({}));
    const crudos = Array.isArray(body.tranches) ? body.tranches : [];
    const tranches = crudos.map((t: any) => ({
      numeroCuota: Number(t.numeroCuota ?? t.numero_cuota),
      importe: String(t.importe ?? 0),
      diasCobertura: Number(t.diasCobertura ?? t.dias_cobertura ?? 0),
    }));
    const scheme = await prisma.$transaction((tx) =>
      service.upsertScheme(tx, { gymId: auth.gymId, planId, tranches }),
    );
    return c.json(scheme, 201);
  } catch (error: any) {
    return fallo(c, error);
  }
});

/** Cuotas materializadas de una membresía, en orden. */
planCuotaRoutes.get("/membresias/:id/cuotas", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  const membershipId = c.req.param("id");
  try {
    const membresia = await prisma.membresiaCliente.findFirst({
      where: { membresia_id: membershipId, gym_id: auth.gymId, is_deleted: false },
      select: { membresia_id: true },
    });
    if (!membresia) {
      return c.json({ error: "La membresía no existe en este gimnasio." }, 404);
    }
    return c.json(
      await service.listMembershipQuotas(prisma as any, auth.gymId, membershipId),
    );
  } catch (error: any) {
    return fallo(c, error);
  }
});

/**
 * R5.4 — cambio de entrenador a petición del cliente, desde la web.
 *
 * Lo ejecuta **recepción sin aprobación previa**: es la regla del dueño y por
 * eso aquí no hay comprobación de administración. El aviso que deja el servicio
 * es informativo, nunca un permiso que haya que conceder antes.
 *
 * La membresía se busca dentro del servicio, acotada por el gimnasio del token:
 * una membresía de otra sede responde 404 igual que una inexistente, sin
 * filtrar que existe en algún sitio.
 */
planCuotaRoutes.post("/membresias/:id/cambiar-entrenador", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await prisma.$transaction((tx) =>
      trainerChanges.change(tx, {
        gymId: auth.gymId,
        membershipId: c.req.param("id"),
        newTrainerId: body.nuevo_entrenador_id ?? null,
        reason: body.motivo ?? null,
        userId: auth.userId,
      }),
    );
    return c.json(result, 201);
  } catch (error: any) {
    return fallo(c, error);
  }
});

/**
 * R5.4 — qué pasaría si se confirmara el cambio, sin escribir nada.
 *
 * El diálogo la llama antes de confirmar. Va por `POST` porque el entrenador
 * destino es parte de la pregunta, y por la misma razón que el cambio: el
 * servidor calcula el dinero, la vista solo lo presenta.
 */
planCuotaRoutes.post("/membresias/:id/cambiar-entrenador/previsualizacion", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await trainerChanges.preview(prisma as any, {
      gymId: auth.gymId,
      membershipId: c.req.param("id"),
      newTrainerId: body.nuevo_entrenador_id ?? null,
    });
    return c.json(result);
  } catch (error: any) {
    return fallo(c, error);
  }
});

/**
 * R5.4 — bandeja de avisos de administración.
 *
 * Solo administración: el aviso existe para que quien dirige el gimnasio se
 * entere de los cambios que recepción ya ejecutó.
 */
planCuotaRoutes.get("/avisos-administracion", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  if (!esAdmin(auth)) {
    return c.json({ error: "Solo administración consulta la bandeja de avisos." }, 403);
  }
  const soloNoLeidos = c.req.query("leidos") !== "todos";
  const avisos = await prisma.avisoAdministracion.findMany({
    where: {
      gym_id: auth.gymId,
      is_deleted: false,
      ...(soloNoLeidos ? { leido: false } : {}),
    },
    orderBy: { created_at: "desc" },
    take: 200,
  });
  return c.json(avisos);
});

/**
 * R5.4 — marcar avisos como leídos: los ids dados, o todos los pendientes.
 *
 * **Leer no borra.** El aviso cambia de estado y sigue en el historial, que es
 * lo que permite consultarlo después desde `?leidos=todos`. Es idempotente:
 * repetir la llamada devuelve 0 actualizados y no falla.
 */
planCuotaRoutes.post("/avisos-administracion/leer", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  if (!esAdmin(auth)) {
    return c.json({ error: "Solo administración marca los avisos como leídos." }, 403);
  }
  try {
    const body = await c.req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.aviso_ids) ? body.aviso_ids : [];
    const now = new Date();
    const actualizados = await prisma.$transaction(async (tx) => {
      const pendientes = await tx.avisoAdministracion.findMany({
        where: {
          gym_id: auth.gymId,
          is_deleted: false,
          leido: false,
          ...(ids.length ? { aviso_id: { in: ids } } : {}),
        },
        select: { aviso_id: true },
      });
      for (const aviso of pendientes) {
        const marcado = await tx.avisoAdministracion.update({
          where: { aviso_id: aviso.aviso_id },
          data: { leido: true, version: { increment: 1 }, updated_at: now },
        });
        // El estado «leído» también viaja: si no, marcarlo en la web se perdería
        // en cuanto el escritorio sincronizara su copia sin leer.
        await tx.syncLog.create({
          data: {
            event_id: crypto.randomUUID(),
            entidad: "aviso_administracion",
            operacion: "UPDATE",
            entidad_id: marcado.aviso_id,
            gym_id: auth.gymId,
            device_id: "WEB_ADMIN",
            payload_json: JSON.stringify(serialize(marcado)),
          },
        });
      }
      return pendientes.length;
    });
    // La clave es `marcados` porque es la que ya consume el cliente Flutter
    // contra la API local. Devolver otra habría hecho que la web contara
    // siempre 0 avisos marcados, sin ningún error visible.
    return c.json({ marcados: actualizados });
  } catch (error: any) {
    return fallo(c, error);
  }
});

/**
 * Marca una cuota como pagada.
 *
 * Es el registro administrativo de una cuota ya cobrada por otra vía; el cobro
 * con dinero va por `POST /pagos/process` con `modo_cuotas`, que además crea
 * pago, detalle y movimiento de tesorería.
 */
planCuotaRoutes.post("/membresias/:id/cuotas/:numero/pagar", async (c) => {
  const auth = actor(c);
  if (!auth) return c.json({ error: "El token no identifica una cuenta del gimnasio." }, 403);
  const membershipId = c.req.param("id");
  const numeroCuota = Number(c.req.param("numero"));
  if (!Number.isInteger(numeroCuota) || numeroCuota < 1) {
    return c.json({ error: "El número de cuota debe ser un entero positivo." }, 400);
  }
  try {
    const membresia = await prisma.membresiaCliente.findFirst({
      where: { membresia_id: membershipId, gym_id: auth.gymId, is_deleted: false },
      select: { membresia_id: true },
    });
    if (!membresia) {
      return c.json({ error: "La membresía no existe en este gimnasio." }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const result = await prisma.$transaction((tx) =>
      service.payInstallment(tx, {
        gymId: auth.gymId,
        membershipId,
        numeroCuota,
        pagoDetalleId: body.pago_detalle_id ?? null,
      }),
    );
    return c.json(result);
  } catch (error: any) {
    return fallo(c, error);
  }
});
