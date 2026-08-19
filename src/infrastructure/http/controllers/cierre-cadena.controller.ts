/**
 * M5 — la puerta de la solicitud de cierre de la cadena (§6.2).
 *
 * Emitirla y retirarla es autoridad de **cadena**, no permiso de sede: la
 * guarda es `requirePlatformAuthority` en la ruta, igual que el precio del plus.
 * Leerla la puede leer cualquier sede —necesita saber qué se le pide— y por eso
 * el GET no lleva esa guarda.
 */
import type { Context } from "hono";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../db/prismaClient";
import {
  actorDeLaCadena,
  CierreCadenaError,
  ESTADO_ABIERTA,
  retirarSolicitudDeCierre,
  solicitarCierreDeCadena,
} from "../../../application/accounting/cierre-cadena-solicitud.service";
import { semaforoDeLaCadena } from "../../../application/accounting/semaforo-cierre.service";

const DISPOSITIVO = "WEB_ADMIN";

const auth = (c: Context) => c.get("auth") as AuthTokenPayload | undefined;

/**
 * El token dice **quién** es, no **cómo se llama**: no lleva el nombre. Por eso
 * el autor se congela leyéndolo de la base y no rellenando huecos con un guion.
 */
const actorDe = (sesion: AuthTokenPayload | undefined) =>
  actorDeLaCadena(prisma, String((sesion as any)?.userId ?? (sesion as any)?.sub ?? ""));

const publico = (fila: any) =>
  fila && {
    solicitud_id: fila.solicitud_id,
    tipo_periodo: fila.tipo_periodo,
    fecha_inicio: fila.fecha_inicio,
    fecha_fin_exclusiva: fila.fecha_fin_exclusiva,
    estado: fila.estado,
    nota: fila.nota,
    fecha_limite: fila.fecha_limite,
    solicitada_por: fila.solicitada_por_nombre_snapshot,
    solicitada_at: fila.solicitada_at,
    retirada_motivo: fila.retirada_motivo,
    retirada_at: fila.retirada_at,
  };

/** Las solicitudes vivas, para que una sede sepa qué se le está pidiendo. */
export async function listarSolicitudesDeCierre(c: Context) {
  const filas = await prisma.cierreCadenaSolicitud.findMany({
    where: { estado: ESTADO_ABIERTA, is_deleted: false },
    orderBy: { fecha_inicio: "desc" },
    take: 100,
  });
  return c.json({ solicitudes: filas.map(publico) });
}

export async function postSolicitudDeCierre(c: Context) {
  const sesion = auth(c);
  try {
    const r = await solicitarCierreDeCadena({
      cuerpo: await c.req.json().catch(() => null),
      actor: await actorDe(sesion),
      sourceDevice: DISPOSITIVO,
    });
    // 200 y no 201 cuando ya estaba: no se ha creado nada nuevo, y el cliente
    // necesita distinguirlo para no decirle al usuario que acaba de pedirlo.
    return c.json(
      { solicitud: publico(r.solicitud), avisos: r.avisos, ya_estaba: r.yaEstaba },
      r.yaEstaba ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof CierreCadenaError) {
      return c.json({ error: error.message }, error.status as 400);
    }
    throw error;
  }
}

export async function postRetiroDeSolicitud(c: Context) {
  const sesion = auth(c);
  const cuerpo = (await c.req.json().catch(() => null)) as any;
  try {
    const r = await retirarSolicitudDeCierre({
      solicitudId: c.req.param("solicitudId"),
      motivo: cuerpo?.motivo,
      actor: await actorDe(sesion),
      sourceDevice: DISPOSITIVO,
    });
    return c.json({ solicitud: publico(r.solicitud), avisos_retirados: r.avisosRetirados });
  } catch (error) {
    if (error instanceof CierreCadenaError) {
      return c.json({ error: error.message }, error.status as 400);
    }
    throw error;
  }
}

/**
 * El semáforo del período (§6.2, paso 4).
 *
 * Se puede preguntar por `solicitud_id` —lo normal: se mira el estado de lo que
 * se pidió— o por fechas sueltas, que es lo que hace falta para ver cómo va un
 * período **antes** de pedir su cierre.
 *
 * Leerlo es autoridad de cadena, y el guardia está en la ruta. No es un detalle
 * de permisos: aquí sale el estado de **todas** las sedes, y una sede no tiene
 * por qué ver si la vecina cerró.
 */
export async function getSemaforoDeCierre(c: Context) {
  try {
    const periodo = await periodoPedido(c);
    const horas = c.req.query("horas_silencio");
    const semaforo = await semaforoDeLaCadena({
      periodo,
      ahora: trustedClock.nowUtc(),
      horasDeSilencioTolerables: horas ? Number(horas) : undefined,
    });
    return c.json({
      periodo: {
        fecha_inicio: semaforo.periodo.fechaInicio,
        fecha_fin_exclusiva: semaforo.periodo.fechaFinExclusiva,
      },
      filas: semaforo.filas,
      puede_firmarse: semaforo.puede_firmarse,
      ausentes: semaforo.ausentes,
    });
  } catch (error) {
    if (error instanceof CierreCadenaError) {
      return c.json({ error: error.message }, error.status as 400);
    }
    throw error;
  }
}

/** De la solicitud si se nombra; si no, de las fechas que lleguen. */
async function periodoPedido(c: Context) {
  const solicitudId = c.req.query("solicitud_id");
  if (solicitudId) {
    const solicitud = await prisma.cierreCadenaSolicitud.findUnique({
      where: { solicitud_id: solicitudId },
    });
    if (!solicitud || solicitud.is_deleted) {
      throw new CierreCadenaError("Esa solicitud no existe.", 404);
    }
    return {
      fechaInicio: solicitud.fecha_inicio,
      fechaFinExclusiva: solicitud.fecha_fin_exclusiva,
    };
  }
  const inicio = new Date(String(c.req.query("fecha_inicio") ?? ""));
  const fin = new Date(String(c.req.query("fecha_fin_exclusiva") ?? ""));
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    throw new CierreCadenaError("Indique una solicitud o un período con fechas válidas.");
  }
  if (fin.getTime() <= inicio.getTime()) {
    throw new CierreCadenaError("El período termina antes de empezar.");
  }
  return { fechaInicio: inicio, fechaFinExclusiva: fin };
}
