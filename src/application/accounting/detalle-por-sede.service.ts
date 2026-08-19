/**
 * M6 — el detalle de cobros de una sede, desde el central (§6.4).
 *
 * «Los mismos informes que ve la sede, en solo lectura», para revisar, auditar o
 * buscar un cobro concreto. Es la vista que se abre cuando el consolidado enseña
 * una cifra rara.
 *
 * ## Solo lectura de verdad
 *
 * Aquí no hay ninguna escritura, y no por casualidad: §6.4 dice que contabilidad
 * central «puede ver todo, pero no cobra, no anula y no firma el cierre de una
 * sede». Esa autoridad se queda donde está el dinero físico.
 *
 * ## El ámbito llega por parámetro, y por eso el guardia es más importante aquí
 *
 * Todo el resto del sistema saca la sede del token (§3.3) —y esa regla es lo que
 * impide que una sede lea a otra—. Esta lectura es la excepción declarada: el
 * central pide **explícitamente** la sede que quiere auditar. Por eso la ruta
 * exige autoridad de cadena: sin ese guardia, este endpoint sería un agujero de
 * aislamiento con forma de informe.
 *
 * ## Firmado si lo hay, vivo si no, y siempre dicho
 *
 * Si el período tiene cierre firmado con detalle, el listado sale de él: es lo
 * que la sede firmó, y auditar contra otra cosa sería auditar contra una cifra
 * que nadie aprobó. El cierre **mensual** no guarda el detalle de pagos en su
 * snapshot, así que ahí se va a lo vivo. En los dos casos la respuesta declara
 * de dónde salió.
 */
import { prisma } from "../../infrastructure/db/prismaClient";
import { decimalToUnits } from "../../domain/money";
import {
  detalleDeLaSede,
  notaDelOrigen,
  totalesDelDetalle,
  type CobroParaDetalle,
  type OrigenDelDetalle,
} from "../../domain/detalle-por-sede-policy";
import { esMesNatural, type PeriodoDelSemaforo } from "./semaforo-cierre.service";

/** Un cobro tal y como se publica en el detalle. */
interface CobroPublicado {
  readonly pago_cliente_id: string;
  readonly ocurrido_at: string | null;
  readonly ci: string | null;
  readonly plan: string | null;
  readonly cuota: string | null;
  readonly moneda_id: string;
  readonly monto_menor: number;
  readonly monto: string;
  readonly clase: string;
  readonly cobrador: string | null;
  readonly anulado: boolean;
}

const menor = (valor: unknown) => {
  try {
    return Number(decimalToUnits(String(valor ?? "0") as never));
  } catch {
    return 0;
  }
};

function parsear(json: string | null | undefined): any {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Las filas que salen de un cierre firmado: **una por pago y moneda**.
 *
 * Se suman todos los detalles del pago, no el primero. Tomar solo el primero
 * perdía los cobros partidos en dos métodos —en el período del recorrido había
 * uno de 10 + 20 en la misma moneda— y el detalle salía veinte por debajo del
 * consolidado. Un detalle que no cuadra con el total que se fue a auditar no
 * sirve para nada.
 *
 * La reversión de un pago anulado **no** resta aquí: el pago entero queda
 * marcado y no suma, así que restarla además lo contaría dos veces.
 */
export function filasDesdeSnapshot(pagos: readonly any[], gymId: string) {
  const cobros: CobroParaDetalle[] = [];
  const publicados: CobroPublicado[] = [];
  for (const pago of pagos) {
    const detalles: any[] = Array.isArray(pago?.detalles) ? pago.detalles : [];
    const porMoneda = new Map<string, number>();
    for (const detalle of detalles) {
      const monedaId = String(detalle?.moneda_id ?? "");
      if (!monedaId) continue;
      if (String(detalle?.origen_tipo ?? "") === "PAGO_REVERSION") continue;
      const signo = String(detalle?.direccion ?? "") === "ENTRADA" ? 1 : -1;
      porMoneda.set(monedaId, (porMoneda.get(monedaId) ?? 0) + signo * menor(detalle?.monto));
    }
    for (const [monedaId, monto] of porMoneda) {
      cobros.push({
        pagoClienteId: String(pago?.pago_cliente_id ?? ""),
        monedaId,
        montoMenor: monto,
        gymId,
        cobradoEnGymId: null,
        anulado: Boolean(pago?.reverso),
      });
      publicados.push({
        pago_cliente_id: String(pago?.pago_cliente_id ?? ""),
        ocurrido_at: pago?.ocurrido_at_utc ?? null,
        ci: pago?.ci ?? null,
        plan: pago?.plan_codigo ?? null,
        cuota: pago?.cuota ?? null,
        moneda_id: monedaId,
        monto_menor: monto,
        monto: (monto / 100).toFixed(2),
        clase: "INGRESO_Y_EFECTIVO",
        cobrador: pago?.cobrador?.nombre ?? null,
        anulado: Boolean(pago?.reverso),
      });
    }
  }
  return { cobros, publicados };
}

/**
 * El detalle de una sede para un período.
 *
 * `gymId` viene de quien pregunta, no del token: es la sede que se audita.
 */
export async function detallePorSede(input: {
  readonly gymId: string;
  readonly periodo: PeriodoDelSemaforo;
}) {
  const sede = await prisma.gym.findFirst({
    where: { gym_id: input.gymId, deleted_at: null },
    select: { gym_id: true, nombre: true, activo: true },
  });
  if (!sede) return null;

  const firmado = esMesNatural(input.periodo)
    ? null
    : await prisma.tesoreriaCierrePeriodo.findFirst({
        where: {
          gym_id: input.gymId,
          fecha_inicio: input.periodo.fechaInicio,
          fecha_fin_exclusiva: input.periodo.fechaFinExclusiva,
          estado: "CERRADO",
          is_deleted: false,
        },
        select: { snapshot_json: true, cerrado_at: true, cerrado_por_nombre_snapshot: true },
      });

  const snapshot = parsear(firmado?.snapshot_json);
  const pagosFirmados = Array.isArray(snapshot?.pagos) ? snapshot.pagos : null;
  const origen: OrigenDelDetalle = pagosFirmados ? "CIERRE_FIRMADO" : "EN_VIVO";

  const cobros: CobroParaDetalle[] = [];
  const publicados: CobroPublicado[] = [];

  if (pagosFirmados) {
    const desdeElCierre = filasDesdeSnapshot(pagosFirmados, input.gymId);
    cobros.push(...desdeElCierre.cobros);
    publicados.push(...desdeElCierre.publicados);
  }

  // Lo vivo: los cobros que **ingresa** esta sede y los que solo pasaron por su
  // caja. Se piden juntos porque las dos listas son «los cobros de esta sede», y
  // pedirlas por separado es como se acaba enseñando solo una.
  const vivos = await prisma.pagoCliente.findMany({
    where: {
      is_deleted: false,
      fecha: { gte: input.periodo.fechaInicio, lt: input.periodo.fechaFinExclusiva },
      OR: [{ gym_id: input.gymId }, { cobrado_en_gym_id: input.gymId }],
    },
    select: {
      pago_cliente_id: true,
      fecha: true,
      ci: true,
      monto_total: true,
      moneda_id: true,
      gym_id: true,
      cobrado_en_gym_id: true,
      plan_codigo_snapshot: true,
      cuota_sufijo_snapshot: true,
      cobrado_por_nombre_snapshot: true,
    },
    orderBy: { fecha: "asc" },
    take: 500,
  });

  const yaFirmados = new Set(publicados.map((p) => p.pago_cliente_id));
  const anulaciones = vivos.length
    ? await prisma.pagoReversion.findMany({
        where: { pago_cliente_id: { in: vivos.map((p) => p.pago_cliente_id) } },
        select: { pago_cliente_id: true },
      })
    : [];
  const anulados = new Set(anulaciones.map((a) => a.pago_cliente_id));

  for (const pago of vivos) {
    if (yaFirmados.has(pago.pago_cliente_id)) continue;
    const monto = menor(pago.monto_total);
    const base: CobroParaDetalle = {
      pagoClienteId: pago.pago_cliente_id,
      monedaId: pago.moneda_id,
      montoMenor: monto,
      gymId: pago.gym_id ?? "",
      cobradoEnGymId: pago.cobrado_en_gym_id,
      anulado: anulados.has(pago.pago_cliente_id),
    };
    cobros.push(base);
  }

  const clasificados = detalleDeLaSede(cobros, input.gymId);
  const claseDe = new Map(clasificados.map((f) => [f.pagoClienteId, f.clase]));

  for (const pago of vivos) {
    if (yaFirmados.has(pago.pago_cliente_id)) continue;
    const clase = claseDe.get(pago.pago_cliente_id);
    if (!clase) continue;
    const monto = menor(pago.monto_total);
    publicados.push({
      pago_cliente_id: pago.pago_cliente_id,
      ocurrido_at: pago.fecha?.toISOString() ?? null,
      ci: pago.ci,
      plan: pago.plan_codigo_snapshot,
      cuota: pago.cuota_sufijo_snapshot,
      moneda_id: pago.moneda_id,
      monto_menor: monto,
      monto: (monto / 100).toFixed(2),
      clase,
      cobrador: pago.cobrado_por_nombre_snapshot,
      anulado: anulados.has(pago.pago_cliente_id),
    });
  }

  return {
    sede: { gym_id: sede.gym_id, nombre: sede.nombre, activa: sede.activo },
    // En `snake_case` como el resto de la API: el período es dato de borde, no
    // el objeto de dominio que se le pasó a este servicio.
    periodo: {
      fecha_inicio: input.periodo.fechaInicio,
      fecha_fin_exclusiva: input.periodo.fechaFinExclusiva,
    },
    origen,
    nota: notaDelOrigen(origen),
    cierre: firmado
      ? { cerrado_at: firmado.cerrado_at, cerrado_por: firmado.cerrado_por_nombre_snapshot }
      : null,
    totales: totalesDelDetalle(clasificados).map((total) => ({
      moneda_id: total.monedaId,
      ingreso_menor: total.ingresoMenor,
      ingreso: (total.ingresoMenor / 100).toFixed(2),
      efectivo_menor: total.efectivoMenor,
      efectivo: (total.efectivoMenor / 100).toFixed(2),
      cobrado_cuenta_ajena_menor: total.cobradoPorCuentaAjenaMenor,
      cobrado_cuenta_ajena: (total.cobradoPorCuentaAjenaMenor / 100).toFixed(2),
      cobros: total.cobros,
      anulados: total.anulados,
    })),
    cobros: publicados,
    // Nunca se escribe desde aquí: el central mira, no cobra ni anula (§6.4).
    solo_lectura: true,
  };
}
