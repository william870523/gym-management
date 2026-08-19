/**
 * M8 — la puerta del saldo entre sedes y de su liquidación (§5.4).
 *
 * Leer el saldo de **otra** sede y registrar que el dinero se movió son actos de
 * **cadena**, no permisos de sede: la guarda es `requirePlatformAuthority` en la
 * ruta, igual que el precio del plus y el consolidado.
 *
 * Que registrar la liquidación sea de la cadena no es burocracia. La
 * transferencia toca **dos negocios**: uno declara que pagó y el otro que
 * cobró. Si la sede deudora pudiera anotarla sola, podría declararse al día sin
 * que la acreedora se enterara, y la única forma de descubrirlo sería que
 * alguien echara de menos el dinero. Quien arbitra entre las dos es el
 * concentrador, y ahí es donde se registra.
 */
import type { Context } from "hono";
import { randomUUID } from "crypto";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../db/prismaClient";
import { actorDeLaCadena, CierreCadenaError } from "../../../application/accounting/cierre-cadena-solicitud.service";
import {
  LiquidacionSaldoError,
  pendientesDeLiquidar,
  type AcreedorDelSaldo,
} from "../../../domain/liquidacion-saldo-policy";
import { saldoDeLaSede } from "../../../application/saldo-enlace/saldo-enlace.service";
import {
  liquidacionesDeLaSede,
  registrarLiquidacion,
} from "../../../application/saldo-enlace/liquidacion-saldo.service";

type Liquidacion = Awaited<ReturnType<typeof liquidacionesDeLaSede>>[number];

const DISPOSITIVO = "WEB_ADMIN";

const auth = (c: Context) => c.get("auth") as AuthTokenPayload | undefined;

const actorDe = (sesion: AuthTokenPayload | undefined) =>
  actorDeLaCadena(prisma, String((sesion as any)?.userId ?? (sesion as any)?.sub ?? ""));

const sedePedida = (c: Context) => {
  const gymId = String(c.req.query("gym_id") ?? "").trim();
  if (!gymId) throw new LiquidacionSaldoError("Indique la sede cuyo saldo quiere ver.");
  return gymId;
};

/** Los nombres de las sedes que aparecen, para no enseñar identificadores. */
async function nombresDeSedes(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const sedes = await prisma.gym.findMany({
    where: { gym_id: { in: [...new Set(ids)] } },
    select: { gym_id: true, nombre: true },
  });
  return new Map(sedes.map((s) => [s.gym_id, s.nombre ?? s.gym_id]));
}

const conNombre = (acreedor: AcreedorDelSaldo, nombres: Map<string, string>) => ({
  tipo: acreedor.tipo,
  gym_id: acreedor.tipo === "SEDE" ? acreedor.gymId : null,
  nombre:
    acreedor.tipo === "CADENA"
      ? "La cadena"
      : nombres.get(acreedor.gymId) ?? acreedor.gymId,
});

/**
 * Lo que una sede debe, por acreedor y moneda.
 *
 * Se devuelven las dos listas: `pendientes` —las deudas vivas, que es lo que se
 * puede liquidar— y `lineas`, el saldo completo. La segunda incluye las
 * saldadas y las pagadas de más, y existe para poder cuadrar a mano: una línea
 * en cero no se puede liquidar, pero desaparecerla sin más deja a quien busca
 * una deuda que recuerda haber visto pensando que se perdió.
 */
export async function getSaldoPendiente(c: Context) {
  try {
    const gymId = sedePedida(c);
    const lineas = await saldoDeLaSede({ tx: prisma, gymId });
    const nombres = await nombresDeSedes(
      lineas.flatMap((l) => (l.acreedor.tipo === "SEDE" ? [l.acreedor.gymId] : [])).concat(gymId),
    );
    const publico = (l: (typeof lineas)[number]) => ({
      acreedor: conNombre(l.acreedor as AcreedorDelSaldo, nombres),
      moneda_id: l.monedaId,
      saldo: l.saldo,
      generado: l.generado,
      deshecho: l.deshecho,
      asientos: l.asientos,
    });
    return c.json({
      sede: { gym_id: gymId, nombre: nombres.get(gymId) ?? gymId },
      pendientes: pendientesDeLiquidar(
        lineas.map((l) => ({
          acreedor: l.acreedor as AcreedorDelSaldo,
          monedaId: l.monedaId,
          saldo: l.saldo,
        })),
      ).map((p) => ({
        acreedor: conNombre(p.acreedor, nombres),
        moneda_id: p.monedaId,
        saldo: p.saldo,
      })),
      lineas: lineas.map(publico),
    });
  } catch (error) {
    return respuestaDeError(c, error);
  }
}

/** El historial de lo que esa sede ya ha liquidado. */
export async function getLiquidaciones(c: Context) {
  try {
    const gymId = sedePedida(c);
    const filas = await liquidacionesDeLaSede({
      tx: prisma,
      gymId,
      limite: Number(c.req.query("limite") ?? 100),
    });
    const nombres = await nombresDeSedes(
      filas.flatMap((f: Liquidacion) => (f.acreedor.tipo === "SEDE" ? [f.acreedor.gymId] : []))
        .concat(gymId),
    );
    return c.json({
      sede: { gym_id: gymId, nombre: nombres.get(gymId) ?? gymId },
      liquidaciones: filas.map((f: Liquidacion) => ({
        ...f,
        acreedor: conNombre(f.acreedor, nombres),
      })),
    });
  } catch (error) {
    return respuestaDeError(c, error);
  }
}

/**
 * Registra que una sede transfirió lo que debía.
 *
 * `liquidacion_id` lo puede traer quien llama para poder **reintentar**: si la
 * respuesta se pierde por el camino, repetir la petición con el mismo
 * identificador devuelve la que ya se registró en vez de anotar el pago dos
 * veces. Sin eso, quien no vio la confirmación vuelve a darle al botón y la sede
 * acaba habiendo «liquidado» el doble de lo que transfirió.
 */
export async function postLiquidacion(c: Context) {
  try {
    const cuerpo = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const actor = await actorDe(auth(c));
    const nowUtc = trustedClock.nowUtc();
    const acreedor = acreedorDelCuerpo(cuerpo);
    const fechaNegocio = fechaDeNegocio(cuerpo, nowUtc);

    const resultado = await prisma.$transaction(async (tx) =>
      registrarLiquidacion({
        tx,
        nowUtc,
        actor,
        pedida: {
          liquidacionId: String(cuerpo.liquidacion_id ?? "").trim() || `liq-${randomUUID()}`,
          deudorGymId: String(cuerpo.gym_id ?? "").trim(),
          acreedor,
          monedaId: String(cuerpo.moneda_id ?? "").trim(),
          monto: String(cuerpo.monto ?? "").trim(),
          aceptaDejarSaldoAFavor: cuerpo.acepta_dejar_saldo_a_favor === true,
          referencia: cuerpo.referencia as string | null,
          nota: cuerpo.nota as string | null,
          fechaNegocio,
          sourceDevice: DISPOSITIVO,
        },
        emitirAsiento: (fila) =>
          registrarEvento(tx, "saldo_enlace_asiento", fila.asiento_id, fila, String(fila.gym_id)),
        emitirLiquidacion: (fila) =>
          registrarEvento(tx, "saldo_liquidacion", fila.liquidacion_id, fila, String(fila.gym_id)),
      }),
    );

    return c.json(
      {
        liquidacion_id: resultado.liquidacion.liquidacion_id,
        asiento_id: resultado.liquidacion.asiento_id,
        saldo_antes: resultado.resuelta.saldoAntes,
        monto: resultado.resuelta.monto,
        saldo_despues: resultado.resuelta.saldoDespues,
        liquida_del_todo: resultado.resuelta.liquidaDeltodo,
        deja_saldo_a_favor: resultado.resuelta.dejaSaldoAFavor,
        ya_estaba: resultado.yaEstaba,
      },
      resultado.yaEstaba ? 200 : 201,
    );
  } catch (error) {
    return respuestaDeError(c, error);
  }
}

function acreedorDelCuerpo(cuerpo: Record<string, unknown>): AcreedorDelSaldo {
  const tipo = String(cuerpo.acreedor_tipo ?? "").trim().toUpperCase();
  if (tipo === "CADENA") return { tipo: "CADENA" };
  if (tipo === "SEDE") {
    return { tipo: "SEDE", gymId: String(cuerpo.acreedor_gym_id ?? "").trim() };
  }
  // No se adivina: la cadena y una sede son acreedores distintos, y elegir por
  // defecto es como se acaba pagando al que no era.
  throw new LiquidacionSaldoError("Indique si se paga a una sede o a la cadena.");
}

/**
 * La fecha de negocio de la sede que paga, no la del servidor.
 *
 * Si no viene, se usa el día del concentrador; la alternativa —rechazar— dejaría
 * sin registrar una transferencia que ya ocurrió, y un pago hecho vale más que
 * una fecha perfecta.
 */
function fechaDeNegocio(cuerpo: Record<string, unknown>, nowUtc: Date): Date {
  const texto = String(cuerpo.fecha_negocio ?? "").trim();
  if (!texto) {
    return new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate()));
  }
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) {
    throw new LiquidacionSaldoError("La fecha de negocio no es una fecha válida.");
  }
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/**
 * El evento lleva la sede **deudora**: la liquidación es suya, igual que el
 * asiento al que acompaña, porque es la que sacó el dinero de su caja.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function registrarEvento(tx: any, entidad: string, entidadId: string, fila: any, gymId: string) {
  await tx.syncLog.create({
    data: {
      event_id: randomUUID(),
      entidad,
      operacion: "INSERT",
      entidad_id: entidadId,
      gym_id: gymId,
      device_id: null,
      payload_json: JSON.stringify(fila),
    },
  });
}

function respuestaDeError(c: Context, error: unknown) {
  if (error instanceof LiquidacionSaldoError || error instanceof CierreCadenaError) {
    return c.json({ error: error.message }, error.status as 400);
  }
  throw error;
}
