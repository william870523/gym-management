import type { Context } from "hono";
import { randomUUID } from "crypto";

import { canonicalRole } from "../../auth/permissions";
import { prisma } from "../../db/prismaClient";
import { trustedClock } from "../../../config/trusted-clock";
import { usuarioSedeId } from "../../../application/auth/usuario-sede";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

const soloDueno = (c: Context) => c.json({
  error: "Asignar una persona a varias sedes es una acción del dueño de la cadena",
  error_code: "PLATFORM_AUTHORITY_REQUIRED",
}, 403);

const esDueno = (c: Context) =>
  (c.get("auth") as AuthTokenPayload | undefined)?.esPlataforma === true;

const membresiaPublica = (fila: any) => ({
  usuario_sede_id: fila.usuario_sede_id,
  user_id: fila.user_id,
  gym_id: fila.gym_id,
  rol: fila.rol,
  activo: fila.activo,
  version: fila.version,
  gym: fila.gym ?? undefined,
});

/**
 * Lista las sedes asignadas a una persona. La consulta es de plataforma: un
 * administrador de sede no puede enumerar la cobertura laboral de otra sede.
 */
export async function getUsuarioSedes(c: Context) {
  if (!esDueno(c)) return soloDueno(c);
  const userId = c.req.param("id").trim();
  const user = await prisma.user.findFirst({
    where: { user_id: userId, is_deleted: false },
    select: { user_id: true },
  });
  if (!user) return c.json({ error: "User not found" }, 404);

  const filas = await prisma.usuarioSede.findMany({
    where: { user_id: userId, is_deleted: false },
    orderBy: { gym_id: "asc" },
  });
  const gyms = await prisma.gym.findMany({
    where: { gym_id: { in: filas.map((fila) => fila.gym_id) } },
    select: { gym_id: true, nombre: true, codigo: true, activo: true },
  });
  const gymPorId = new Map(gyms.map((gym) => [gym.gym_id, gym]));
  return c.json(filas.map((fila) => membresiaPublica({
    ...fila,
    gym: gymPorId.get(fila.gym_id),
  })));
}

/**
 * Asigna o reactiva una sede. El gimnasio objetivo viene en la RUTA y se
 * valida contra la base; el cuerpo solo contiene el rol. Así nunca se acepta
 * un `gym_id` libre enviado dentro del payload.
 *
 * El evento `user` se publica antes que `usuario_sede`, ambos para la sede
 * objetivo y dentro de la misma transacción. Una instalación nueva recibe
 * primero la cuenta padre y después la pertenencia, sin depender de fixtures.
 */
export async function putUsuarioSede(c: Context) {
  if (!esDueno(c)) return soloDueno(c);
  const userId = c.req.param("id").trim();
  const gymId = c.req.param("gymId").trim();
  const body = await c.req.json().catch(() => null);
  const rol = canonicalRole(body?.rol);
  if (!rol) {
    return c.json({
      error: "El rol de la sede no pertenece al catálogo del producto",
      error_code: "INVALID_SITE_ROLE",
    }, 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [user, gym] = await Promise.all([
        tx.user.findFirst({
          where: { user_id: userId, active: true, is_deleted: false },
        }),
        tx.gym.findFirst({
          where: { gym_id: gymId, activo: true, deleted_at: null },
          select: { gym_id: true },
        }),
      ]);
      if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
      if (!gym) throw Object.assign(new Error("Gym not found"), { status: 404 });

      const ahora = trustedClock.nowUtc();
      const id = usuarioSedeId(userId, gymId);
      const existente = await tx.usuarioSede.findUnique({
        where: { usuario_sede_id: id },
      });
      const operacion = existente ? "UPDATE" : "INSERT";
      const fila = await tx.usuarioSede.upsert({
        where: { usuario_sede_id: id },
        create: {
          usuario_sede_id: id,
          user_id: userId,
          gym_id: gymId,
          rol,
          activo: true,
          is_deleted: false,
          created_at: ahora,
          updated_at: ahora,
        },
        update: {
          rol,
          activo: true,
          is_deleted: false,
          deleted_at: null,
          version: { increment: 1 },
          updated_at: ahora,
        },
      });

      // Padre antes que relación: el cursor conserva este orden.
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "user",
          operacion: "UPDATE",
          entidad_id: user.user_id,
          gym_id: gymId,
          payload_json: JSON.stringify(user),
        },
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "usuario_sede",
          operacion,
          entidad_id: fila.usuario_sede_id,
          gym_id: gymId,
          payload_json: JSON.stringify(fila),
        },
      });
      return fila;
    });
    return c.json(membresiaPublica(result));
  } catch (error: any) {
    const status = error?.status === 404 ? 404 : 500;
    return c.json({ error: error?.message ?? "Internal Server Error" }, status);
  }
}

/** Retira una sede secundaria. La sede por defecto no se puede retirar porque
 * el contrato de transición todavía la acepta como pertenencia implícita. */
export async function deleteUsuarioSede(c: Context) {
  if (!esDueno(c)) return soloDueno(c);
  const userId = c.req.param("id").trim();
  const gymId = c.req.param("gymId").trim();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { user_id: userId, is_deleted: false },
        select: { gym_id: true },
      });
      if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
      if (user.gym_id === gymId) {
        throw Object.assign(new Error(
          "La sede principal no se puede retirar; primero debe cambiarse la sede principal",
        ), { status: 409, code: "DEFAULT_GYM_MEMBERSHIP_REQUIRED" });
      }
      const id = usuarioSedeId(userId, gymId);
      const existente = await tx.usuarioSede.findFirst({
        where: { usuario_sede_id: id, user_id: userId, gym_id: gymId, is_deleted: false },
      });
      if (!existente) throw Object.assign(new Error("Assignment not found"), { status: 404 });
      const ahora = trustedClock.nowUtc();
      const fila = await tx.usuarioSede.update({
        where: { usuario_sede_id: id },
        data: {
          activo: false,
          is_deleted: true,
          deleted_at: ahora,
          updated_at: ahora,
          version: { increment: 1 },
        },
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "usuario_sede",
          operacion: "DELETE",
          entidad_id: fila.usuario_sede_id,
          gym_id: gymId,
          payload_json: JSON.stringify(fila),
        },
      });
      return fila;
    });
    return c.json({ ok: true, usuario_sede_id: result.usuario_sede_id });
  } catch (error: any) {
    const status = error?.status === 404 || error?.status === 409 ? error.status : 500;
    return c.json({
      error: error?.message ?? "Internal Server Error",
      ...(error?.code ? { error_code: error.code } : {}),
    }, status);
  }
}
