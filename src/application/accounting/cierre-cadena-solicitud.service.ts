/**
 * M5 — contabilidad central **pide** el cierre de un período
 * (docs/MULTI_SEDE.md §6.2).
 *
 * El central no cierra: pide. Cada sede ejecuta y firma su propio cierre con su
 * arqueo físico, porque el dinero está allí. Este servicio solo emite la
 * petición, la retira si procede, y deja el aviso en la bandeja de cada sede.
 *
 * ## Quién puede pedirlo
 *
 * El **Dueño de la cadena** (`esPlataforma`), por el mismo motivo que fija el
 * precio del plus: si cualquier sede pudiera pedirle a las demás que cierren, la
 * solicitud dejaría de ser de la cadena. §6.4 describe además un rol de
 * «contabilidad central» de solo lectura sobre las sedes; ese rol es de M6, y
 * hasta que exista su autoridad vive donde ya está la de la cadena.
 *
 * ## Por qué el identificador se deriva del período
 *
 * Pedir dos veces el cierre de julio tiene que ser **la misma solicitud**, no
 * dos. Con un identificador derivado, reintentar es un upsert sobre la misma
 * fila; con uno aleatorio, cada clic dejaría un aviso más en cada sede y el
 * semáforo no sabría contra cuál medir.
 */
import { createHash, randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";

export const AVISO_CIERRE_SOLICITADO = "CIERRE_CADENA_SOLICITADO";
export const ESTADO_ABIERTA = "ABIERTA";
export const ESTADO_RETIRADA = "RETIRADA";

export class CierreCadenaError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface ActorDeLaSolicitud {
  readonly userId: string;
  readonly nombre: string;
  readonly rol: string;
}

/** Lo mínimo que hace falta de la tabla de usuarios para congelar al autor. */
export interface ClienteDeActores {
  readonly user: {
    findFirst(args: {
      where: { user_id: string; active: boolean; is_deleted: boolean };
      select: { user_id: true; user_nombre: true; role: true };
    }): Promise<{ user_id: string; user_nombre: string | null; role: string | null } | null>;
  };
}

/**
 * Quién pide el cierre, congelado desde la base y no desde el token.
 *
 * El token trae `userId` y `role`, pero **no el nombre**, así que tomarlo de
 * ahí dejaba la solicitud firmada por «—». Un acto de contabilidad central sin
 * autor legible es peor que uno sin registrar: parece auditado y no lo está, y
 * la sede que recibe el aviso no puede saber a quién preguntarle por él.
 *
 * No se reutiliza `resolveFrozenActor` a propósito: aquel exige que la cuenta
 * pertenezca a **la sede** del token, que es justo lo que este acto no es. El
 * Dueño de la cadena puede tener seleccionada una sede que no es la suya (M2), y
 * con aquella comprobación se le negaría pedir un cierre por estar mirando otra
 * sede. La autoridad ya la comprobó la ruta; aquí solo se pone el nombre.
 *
 * Falla cerrado: una sesión que no se puede identificar no pide nada.
 */
export async function actorDeLaCadena(
  client: ClienteDeActores,
  userId: string | null | undefined,
): Promise<ActorDeLaSolicitud> {
  const id = String(userId ?? "").trim();
  if (!id) throw new CierreCadenaError("No se pudo identificar quién pide el cierre.", 401);
  const user = await client.user.findFirst({
    where: { user_id: id, active: true, is_deleted: false },
    select: { user_id: true, user_nombre: true, role: true },
  });
  if (!user) {
    throw new CierreCadenaError("La cuenta que pide el cierre no está activa.", 403);
  }
  return {
    userId: user.user_id,
    nombre: (user.user_nombre ?? "").trim() || user.user_id,
    rol: (user.role ?? "").trim() || "user",
  };
}

export interface PeriodoPedido {
  readonly tipoPeriodo: string;
  readonly fechaInicio: Date;
  readonly fechaFinExclusiva: Date;
}

/** Derivado del período: pedir dos veces lo mismo es la misma solicitud. */
export function solicitudIdDe(periodo: PeriodoPedido): string {
  const clave = [
    periodo.tipoPeriodo,
    periodo.fechaInicio.toISOString(),
    periodo.fechaFinExclusiva.toISOString(),
  ].join("|");
  return `ccs-${createHash("sha256").update(clave).digest("hex").slice(0, 32)}`;
}

function periodoValido(entrada: unknown): PeriodoPedido {
  const cuerpo = (entrada ?? {}) as Record<string, unknown>;
  const tipo = String(cuerpo.tipo_periodo ?? "").trim().toUpperCase();
  if (!tipo) throw new CierreCadenaError("Falta el tipo de período.");
  const inicio = new Date(String(cuerpo.fecha_inicio ?? ""));
  const fin = new Date(String(cuerpo.fecha_fin_exclusiva ?? ""));
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    throw new CierreCadenaError("El período no trae fechas válidas.");
  }
  if (fin.getTime() <= inicio.getTime()) {
    // Un período vacío o invertido no se puede cerrar, y el semáforo lo
    // enseñaría igual: mejor que no llegue a existir.
    throw new CierreCadenaError("El período termina antes de empezar.");
  }
  return { tipoPeriodo: tipo, fechaInicio: inicio, fechaFinExclusiva: fin };
}

/**
 * Emite la solicitud y deja un aviso en la bandeja de **cada sede activa**.
 *
 * El aviso es por sede porque la bandeja lo es: `aviso_administracion` lleva
 * `gym_id` y cada instalación descarga la suya. La solicitud, en cambio, es una
 * sola y viaja como catálogo de la cadena.
 */
export async function solicitarCierreDeCadena(input: {
  cuerpo: unknown;
  actor: ActorDeLaSolicitud;
  sourceDevice: string;
}) {
  const periodo = periodoValido(input.cuerpo);
  const cuerpo = (input.cuerpo ?? {}) as Record<string, unknown>;
  const nota = cuerpo.nota == null ? null : String(cuerpo.nota).trim() || null;
  const limiteCrudo = cuerpo.fecha_limite ? new Date(String(cuerpo.fecha_limite)) : null;
  if (limiteCrudo && Number.isNaN(limiteCrudo.getTime())) {
    throw new CierreCadenaError("La fecha límite no es válida.");
  }
  const now = trustedClock.nowUtc();
  const solicitudId = solicitudIdDe(periodo);

  return prisma.$transaction(async (tx) => {
    const existente = await tx.cierreCadenaSolicitud.findUnique({
      where: { solicitud_id: solicitudId },
    });
    if (existente && !existente.is_deleted && existente.estado === ESTADO_ABIERTA) {
      // No es un error: es que ya está pedido. Devolverlo tal cual evita que
      // dos clics dejen dos avisos en cada sede.
      return { solicitud: existente, avisos: 0, yaEstaba: true };
    }

    const fila = {
      tipo_periodo: periodo.tipoPeriodo,
      fecha_inicio: periodo.fechaInicio,
      fecha_fin_exclusiva: periodo.fechaFinExclusiva,
      estado: ESTADO_ABIERTA,
      nota,
      fecha_limite: limiteCrudo,
      solicitada_por_user_id: input.actor.userId,
      solicitada_por_nombre_snapshot: input.actor.nombre,
      solicitada_por_rol_snapshot: input.actor.rol,
      solicitada_at: now,
      retirada_motivo: null,
      retirada_at: null,
      source_device: input.sourceDevice,
      is_deleted: false,
      deleted_at: null,
      updated_at: now,
    };
    const solicitud = await tx.cierreCadenaSolicitud.upsert({
      where: { solicitud_id: solicitudId },
      create: { solicitud_id: solicitudId, ...fila, created_at: now, version: 1 },
      update: { ...fila, version: { increment: 1 } },
    });

    await registrarEvento(tx, solicitudId, existente ? "UPDATE" : "INSERT", solicitud);

    // Un aviso por sede viva. Las de baja no se avisan: no van a cerrar nada.
    const sedes = await tx.gym.findMany({
      where: { activo: true, deleted_at: null },
      select: { gym_id: true },
    });
    for (const sede of sedes) {
      const aviso = await tx.avisoAdministracion.create({
        data: {
          aviso_id: randomUUID(),
          gym_id: sede.gym_id,
          tipo: AVISO_CIERRE_SOLICITADO,
          referencia_id: solicitudId,
          mensaje:
            `Administración solicita cerrar el período ${periodo.tipoPeriodo} ` +
            `${periodo.fechaInicio.toISOString().slice(0, 10)} → ` +
            `${periodo.fechaFinExclusiva.toISOString().slice(0, 10)}` +
            (nota ? `. ${nota}` : "."),
          actor_user_id: input.actor.userId,
          actor_nombre: input.actor.nombre,
          leido: false,
          source_device: input.sourceDevice,
          version: 1,
          is_deleted: false,
          created_at: now,
          updated_at: now,
        },
      });
      await registrarEvento(tx, aviso.aviso_id, "INSERT", aviso, sede.gym_id);
    }

    return { solicitud, avisos: sedes.length, yaEstaba: false };
  });
}

/**
 * Retira la solicitud. No borra los cierres que ya se firmaron por ella.
 *
 * **Y se lleva sus avisos.** Retirar la petición y dejar el aviso puesto deja a
 * cada sede reclamada por un cierre que ya nadie pide: el mostrador seguiría
 * viendo «Administración solicita cerrar el período X» sin manera de saber que
 * se retiró. Es la misma regla que el proyecto aprendió con los datos y su
 * rastro —uno sin el otro es una divergencia esperando turno—, aplicada aquí al
 * aviso y a la petición que lo justifica.
 */
export async function retirarSolicitudDeCierre(input: {
  solicitudId: string;
  motivo: unknown;
  actor: ActorDeLaSolicitud;
  sourceDevice: string;
}) {
  const motivo = String(input.motivo ?? "").trim();
  if (!motivo) throw new CierreCadenaError("Retirar una solicitud exige motivo.");
  const now = trustedClock.nowUtc();

  return prisma.$transaction(async (tx) => {
    const actual = await tx.cierreCadenaSolicitud.findUnique({
      where: { solicitud_id: input.solicitudId },
    });
    if (!actual || actual.is_deleted) {
      throw new CierreCadenaError("Esa solicitud no existe.", 404);
    }
    if (actual.estado !== ESTADO_ABIERTA) {
      throw new CierreCadenaError("Esa solicitud ya no está abierta.", 409);
    }
    const solicitud = await tx.cierreCadenaSolicitud.update({
      where: { solicitud_id: input.solicitudId },
      data: {
        estado: ESTADO_RETIRADA,
        retirada_motivo: motivo,
        retirada_at: now,
        source_device: input.sourceDevice,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    await registrarEvento(tx, input.solicitudId, "UPDATE", solicitud);

    const avisos = await tx.avisoAdministracion.findMany({
      where: {
        tipo: AVISO_CIERRE_SOLICITADO,
        referencia_id: input.solicitudId,
        is_deleted: false,
      },
    });
    for (const aviso of avisos) {
      const retirado = await tx.avisoAdministracion.update({
        where: { aviso_id: aviso.aviso_id },
        data: {
          is_deleted: true,
          deleted_at: now,
          source_device: input.sourceDevice,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await registrarEvento(tx, aviso.aviso_id, "DELETE", retirado, aviso.gym_id);
    }

    return { solicitud, avisosRetirados: avisos.length };
  });
}

/**
 * El evento viaja **sin sede**: la solicitud es de la cadena y tiene que llegar
 * a todas las instalaciones. Los avisos, en cambio, llevan la suya.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function registrarEvento(tx: any, entidadId: string, operacion: string, fila: any, gymId: string | null = null) {
  await tx.syncLog.create({
    data: {
      event_id: randomUUID(),
      entidad: gymId === null ? "cierre_cadena_solicitud" : "aviso_administracion",
      operacion,
      entidad_id: entidadId,
      gym_id: gymId,
      device_id: null,
      payload_json: JSON.stringify(fila),
    },
  });
}
