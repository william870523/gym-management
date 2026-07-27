import { Hono } from "hono";
import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
  PlanInstallmentService,
  PlanInstallmentServiceError,
} from "../../../application/membership/plan-installment.service";
import { PlanInstallmentPolicyError } from "../../../domain/plan-installment-policy";

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
