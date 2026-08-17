/**
 * M4a — productor HTTP del acceso multi-sede en el remoto.
 *
 * Dos recursos con dueños distintos, y conviene no mezclarlos:
 *
 * - **El precio** es de la cadena. Lo fija el Dueño de plataforma y ninguna
 *   sede lo toca (§9-bis). Su evento viaja con `gym_id: null` porque tiene que
 *   llegar a **todas** las instalaciones, igual que `gym`.
 * - **El acceso de un socio** lo marca recepción, en su propia sede. Su evento
 *   también viaja con `gym_id: null`: marcar a alguien como multi-sede replica
 *   su información a todas las sedes en la siguiente sincronización, sin
 *   esperar a que se presente en ninguna, porque ya compró el derecho a entrar
 *   en cualquiera (§9-bis, decisión del dueño del 27-07-2026).
 */
import type { Context } from "hono";
import { randomUUID } from "crypto";

import { prisma } from "../../db/prismaClient";
import { trustedClock } from "../../../config/trusted-clock";
import { datePartsInZone } from "../../../config/tz";
import { env } from "../../../config/env";
import {
  AccesoMultisedeError,
  fijarPrecioGlobal,
  leerPrecioGlobal,
  marcarAccesoMultisede,
  proyectarVisitante,
  retirarAccesoMultisede,
  retirarVisitante,
} from "../../../application/acceso-multisede/acceso-multisede.service";
import { accesoCubre } from "../../../domain/acceso-multisede-policy";
import { normalizeMoney } from "../../../domain/money";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

const DISPOSITIVO = "WEB_ADMIN";

const auth = (c: Context) => c.get("auth") as AuthTokenPayload | undefined;

/** Fecha de negocio de la sede, no la del servidor (docs/TIME_CONTRACT.md). */
async function fechaNegocio(tx: any, gymId: string) {
  const gym = await tx.gym.findUnique({
    where: { gym_id: gymId },
    select: { timezone: true },
  });
  const partes = datePartsInZone(
    gym?.timezone?.trim() || env.defaultGymTimezone,
    trustedClock.nowUtc(),
  );
  return new Date(Date.UTC(partes.year, partes.month - 1, partes.day));
}

const precioPublico = (fila: any) =>
  fila
    ? {
        acceso_multisede_precio_id: fila.acceso_multisede_precio_id,
        // `Decimal.toString()` se come los ceros de la derecha y devolvería
        // "150" donde el contrato exige "150.00". El adaptador de Flutter
        // acepta texto, pero texto CON su escala: es la frontera donde el
        // importe deja de ser exacto sin que nadie lo note.
        precio: normalizeMoney(fila.precio),
        moneda_id: fila.moneda_id,
        version: fila.version,
      }
    : null;

const accesoPublico = (fila: any, hoy: Date) =>
  fila
    ? {
        cliente_acceso_multisede_id: fila.cliente_acceso_multisede_id,
        ci: fila.ci,
        gym_id: fila.gym_id,
        activo: fila.activo,
        vigente_hasta: fila.vigente_hasta,
        vigente: accesoCubre(fila, hoy),
        precio_snapshot: normalizeMoney(fila.precio_snapshot),
        moneda_id: fila.moneda_id,
        marcado_por_user_id: fila.marcado_por_user_id,
        marcado_en_gym_id: fila.marcado_en_gym_id,
        version: fila.version,
      }
    : null;

function responderError(c: Context, error: unknown) {
  if (error instanceof AccesoMultisedeError) {
    return c.json({ error: error.message, error_code: error.errorCode }, error.status as any);
  }
  const mensaje = error instanceof Error ? error.message : "Internal Server Error";
  return c.json({ error: mensaje }, 500);
}

/** Precio vigente del plus. Lo lee cualquier sede: necesita saber qué cobrar. */
export async function getPrecioAccesoMultisede(c: Context) {
  const fila = await leerPrecioGlobal(prisma);
  return c.json({ precio: precioPublico(fila) });
}

/**
 * Fija el precio global. Reservado al Dueño de la cadena: si cada sede pudiera
 * ponerlo, el plus dejaría de ser un ingreso de la cadena y volvería el
 * problema de §5.1 —margen inflado y consolidado contando dos veces—.
 */
export async function putPrecioAccesoMultisede(c: Context) {
  const sesion = auth(c);
  if (sesion?.esPlataforma !== true) {
    return c.json({
      error: "El precio del acceso multi-sede es del dueño de la cadena",
      error_code: "PLATFORM_AUTHORITY_REQUIRED",
    }, 403);
  }
  const body = await c.req.json().catch(() => null);
  try {
    const cambio = await prisma.$transaction(async (tx) => {
      const resultado = await fijarPrecioGlobal({
        tx,
        precio: body?.precio,
        monedaId: body?.moneda_id,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "acceso_multisede_precio",
          operacion: resultado.operation,
          entidad_id: resultado.row.acceso_multisede_precio_id,
          // Global: el precio del plus rige en toda la cadena.
          gym_id: null,
          payload_json: JSON.stringify(resultado.row),
        },
      });
      return resultado;
    });
    return c.json({ precio: precioPublico(cambio.row) });
  } catch (error) {
    return responderError(c, error);
  }
}

/** Acceso multi-sede de un socio, con su vigencia ya derivada. */
export async function getAccesoMultisedeCliente(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId) return c.json({ error: "La sesión no identifica gimnasio." }, 403);
  const ci = c.req.param("ci").trim();
  const fila = await prisma.clienteAccesoMultisede.findFirst({
    where: { ci, is_deleted: false },
  });
  const hoy = await fechaNegocio(prisma, sesion.gymId);
  return c.json({ acceso: accesoPublico(fila, hoy) });
}


/**
 * Socios de OTRAS sedes que la sede activa puede atender. Gemelo del local.
 *
 * Nace del recorrido del 16-08: el mostrador buscaba solo en el padrón de la
 * sede y por eso no encontraba a ningún visitante, sin error y sin entrada.
 * Devuelve también a quien tiene el plus vencido, marcado, para que el
 * mostrador pueda decir por qué en vez de no encontrar a nadie.
 */
export async function listarVisitantes(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId) return c.json({ error: "La sesión no identifica gimnasio." }, 403);
  const hoy = await fechaNegocio(prisma, sesion.gymId);
  const copias = await prisma.clienteVisitante.findMany({
    where: { is_deleted: false, gym_id_origen: { not: sesion.gymId } },
    orderBy: [{ apellidos: "asc" }, { nombres: "asc" }],
  });
  if (copias.length === 0) return c.json({ visitantes: [] });

  const accesos = await prisma.clienteAccesoMultisede.findMany({
    where: { ci: { in: copias.map((copia) => copia.ci) }, is_deleted: false },
  });
  const accesoPorCi = new Map(accesos.map((acceso) => [acceso.ci, acceso]));

  return c.json({
    visitantes: copias.map((copia) => ({
      ci: copia.ci,
      nombres: copia.nombres,
      apellidos: copia.apellidos,
      gym_id_origen: copia.gym_id_origen,
      membresia_estado: copia.membresia_estado,
      membresia_fecha_fin: copia.membresia_fecha_fin,
      acceso_vigente: accesoCubre(accesoPorCi.get(copia.ci) as any, hoy),
    })),
  });
}

/**
 * Marca o renueva el acceso multi-sede de un socio.
 *
 * **Acotado a los socios de la sede activa**, salvo para el Dueño. Vender el
 * plus a un socio ajeno es parte del cobro cruzado (§5.3), que es M4b y trae
 * consigo el saldo entre sedes; permitirlo aquí registraría el ingreso en la
 * sede equivocada, que es el riesgo contable más caro que nombra §7.10.
 */
export async function postAccesoMultisedeCliente(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId || !sesion.sub) {
    return c.json({ error: "La sesión no identifica gimnasio y operador." }, 403);
  }
  const ci = c.req.param("ci").trim();
  try {
    const cambio = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.findFirst({
        where: { ci, is_deleted: false },
        select: { gym_id: true },
      });
      if (!cliente) {
        throw new AccesoMultisedeError(
          404,
          "CLIENTE_NO_ENCONTRADO",
          "No existe un socio activo con esa identificación.",
        );
      }
      if (
        sesion.esPlataforma !== true &&
        (cliente.gym_id ?? sesion.gymId) !== sesion.gymId
      ) {
        throw new AccesoMultisedeError(
          403,
          "CLIENTE_DE_OTRA_SEDE",
          "El socio pertenece a otra sede. El cobro por cuenta ajena todavía no está habilitado.",
        );
      }

      const resultado = await marcarAccesoMultisede({
        tx,
        ci,
        marcadoEnGymId: sesion.gymId!,
        marcadoPorUserId: sesion.sub,
        fechaNegocio: await fechaNegocio(tx, sesion.gymId!),
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });

      // La persona antes que su permiso: quien reciba los dos eventos en orden
      // tiene a quién buscar antes de saber que puede dejarle entrar.
      const visitante = await proyectarVisitante({
        tx,
        ci,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "cliente_visitante",
          operacion: visitante.operation,
          entidad_id: visitante.row.ci,
          gym_id: null,
          payload_json: JSON.stringify(visitante.row),
        },
      });

      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "cliente_acceso_multisede",
          operacion: resultado.operation,
          entidad_id: resultado.row.cliente_acceso_multisede_id,
          // Global: la marca tiene que llegar a TODAS las sedes, no solo a la
          // del socio, o la sede visitada no sabría que puede dejarle entrar.
          gym_id: null,
          payload_json: JSON.stringify(resultado.row),
        },
      });
      return resultado;
    });
    const hoy = await fechaNegocio(prisma, sesion.gymId);
    return c.json({ acceso: accesoPublico(cambio.row, hoy) }, cambio.operation === "INSERT" ? 201 : 200);
  } catch (error) {
    return responderError(c, error);
  }
}

/** Retira el acceso. Conserva la fila: su historia es lo que se consulta cuando
 * un socio reclama que le dejaron fuera en otra sede. */
export async function deleteAccesoMultisedeCliente(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId) return c.json({ error: "La sesión no identifica gimnasio." }, 403);
  const ci = c.req.param("ci").trim();
  try {
    const cambio = await prisma.$transaction(async (tx) => {
      // El mismo guarda que el alta: sin él, recepción de una sede podía
      // cancelarle el plus a un socio ajeno aunque venderlo estuviera
      // prohibido. Lo destapó la sonda de elegibilidad del 16-08.
      const cliente = await tx.cliente.findFirst({
        where: { ci, is_deleted: false },
        select: { gym_id: true },
      });
      if (
        cliente &&
        sesion.esPlataforma !== true &&
        (cliente.gym_id ?? sesion.gymId) !== sesion.gymId
      ) {
        throw new AccesoMultisedeError(
          403,
          "CLIENTE_DE_OTRA_SEDE",
          "El socio pertenece a otra sede: su acceso multi-sede se administra allí.",
        );
      }
      const resultado = await retirarAccesoMultisede({
        tx,
        ci,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "cliente_acceso_multisede",
          operacion: "UPDATE",
          entidad_id: resultado.row.cliente_acceso_multisede_id,
          gym_id: null,
          payload_json: JSON.stringify(resultado.row),
        },
      });

      // El camino de vuelta: sin esto, la copia se quedaría en todas las sedes
      // para siempre y el padrón de cada una acabaría siendo el de la cadena.
      const visitante = await retirarVisitante({
        tx,
        ci,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      if (visitante) {
        await tx.syncLog.create({
          data: {
            event_id: randomUUID(),
            entidad: "cliente_visitante",
            operacion: "DELETE",
            entidad_id: visitante.row.ci,
            gym_id: null,
            payload_json: JSON.stringify(visitante.row),
          },
        });
      }
      return resultado;
    });
    const hoy = await fechaNegocio(prisma, sesion.gymId);
    return c.json({ acceso: accesoPublico(cambio.row, hoy) });
  } catch (error) {
    return responderError(c, error);
  }
}
