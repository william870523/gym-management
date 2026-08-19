/**
 * M5 — el semáforo de cierre, alimentado con los cierres de verdad
 * (docs/MULTI_SEDE.md §6.2 y §6.3).
 *
 * `semaforo-cierre-policy` decide **qué significa** cada estado. Este fichero le
 * pone delante los datos: qué firmó cada sede para el período que se le pidió,
 * con qué diferencias de arqueo, cuántos movimientos se quedaron sueltos y
 * cuándo se supo por última vez de esa instalación.
 *
 * Vive solo en el concentrador y no tiene gemelo en la instalación, a
 * diferencia de la política. No es un descuido: una sede **no puede** calcular
 * este semáforo, porque no tiene delante los cierres de las demás. Duplicarlo
 * allí sería prometer una lectura que esa base no puede dar.
 *
 * ## Dos tablas, no una: el mes natural no vive donde los demás períodos
 *
 * Un rango que cae en un mes natural exacto **nunca** produce fila en
 * `tesoreria_cierre_periodo`: la instalación lo desvía al cierre mensual formal
 * y lo firma en `tesoreria_cierre_mensual` (`treasury-period-close.service`
 * delega, y `PERSONALIZADO` sobre un mes natural se rechaza con `USE_MENSUAL`).
 * Como pedir el cierre de julio es justo el caso corriente, un semáforo que solo
 * mirara `tesoreria_cierre_periodo` enseñaría **SIN_CERRAR para siempre** a
 * sedes que firmaron en plazo, y el administrador reclamaría un cierre que ya
 * está hecho.
 *
 * ## Se busca por rango, no por el nombre del período
 *
 * La solicitud trae el vocabulario del central («MES», «RANGO») y el cierre
 * lleva el de la sede (`MENSUAL`, `SEMANAL`, `DIARIO`, `PERSONALIZADO`), que la
 * instalación deriva de la forma del rango. Cruzarlos por ese texto dejaría sin
 * encontrar cierres que existen. Lo que las dos partes comparten es el rango de
 * fechas comerciales, y por eso es la clave. Las fechas se guardan ya como
 * fecha **comercial** de cada sede (§6.3), así que se comparan tal cual.
 */
import { prisma } from "../../infrastructure/db/prismaClient";
import { decimalToUnits } from "../../domain/money";
import {
  consolidarSemaforo,
  type DescuadreDeMoneda,
  type EntradaDelSemaforo,
} from "../../domain/semaforo-cierre-policy";

export interface PeriodoDelSemaforo {
  readonly fechaInicio: Date;
  readonly fechaFinExclusiva: Date;
}

/** Un arqueo aprobado o dentro de tolerancia ya lo miró alguien con autoridad. */
const DESCUADRE_JUSTIFICADO = new Set(["APROBADA", "DENTRO_TOLERANCIA"]);

const diaTexto = (fecha: Date) => fecha.toISOString().slice(0, 10);

/** El rango cubre un mes natural completo, que es el que firma el cierre mensual. */
export function esMesNatural(periodo: PeriodoDelSemaforo): boolean {
  const inicio = periodo.fechaInicio;
  const fin = periodo.fechaFinExclusiva;
  if (inicio.getUTCDate() !== 1 || fin.getUTCDate() !== 1) return false;
  const siguiente = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 1));
  return diaTexto(fin) === diaTexto(siguiente);
}

/** `YYYY-MM`, que es como `tesoreria_cierre_mensual` guarda el mes. */
export function mesDe(periodo: PeriodoDelSemaforo): string {
  return diaTexto(periodo.fechaInicio).slice(0, 7);
}

export interface CierreDiarioFila {
  readonly gymId: string;
  readonly cuentaId: string;
  readonly monedaId: string;
  readonly fechaNegocio: Date;
  readonly diferencia: unknown;
  readonly aprobacionEstado: string;
}

export interface MovimientoFila {
  readonly movimientoId: string;
  readonly gymId: string;
  readonly cuentaId: string | null;
  readonly fechaNegocio: Date;
  readonly requiereRevision: boolean;
}

export interface ConciliacionFila {
  readonly gymId: string;
  readonly movimientoIds: readonly string[];
}

export interface IncidenciasDeSede {
  readonly descuadres: DescuadreDeMoneda[];
  readonly movimientosPendientes: number;
}

/**
 * Lo que impide dar por buena una sede que **sí** cerró.
 *
 * Son las dos incidencias que nombra §6.2 —«cerró con diferencias o movimientos
 * pendientes»— leídas desde el concentrador:
 *
 * - **Diferencias**: la suma de los arqueos diarios que no cuadraron y que
 *   nadie justificó. Va **por moneda**, nunca en un total: mezclar monedas es
 *   una cifra sin significado, y además podría cancelarse sola.
 * - **Movimientos pendientes**: los que están dentro del período y no los cubre
 *   ningún arqueo firmado de su cuenta y día, o piden revisión, o se quedaron
 *   sin cuenta. Una conciliación posterior los da por resueltos, que es
 *   exactamente para lo que existe.
 *
 * Esto **no recalcula el cierre** (§6.3 lo prohíbe: el consolidado agrega, no
 * rehace). Cuenta lo que quedó fuera de él, que es cosa distinta y es lo único
 * que el central puede ver sin volver a contar el dinero de la sede. Y es el
 * caso realista desde M4b: un cobro por cuenta ajena hecho sin conexión llega
 * al concentrador **después** de que su sede firmara el período.
 */
export function incidenciasDeLaSede(datos: {
  readonly cierresDiarios: readonly CierreDiarioFila[];
  readonly movimientos: readonly MovimientoFila[];
  readonly conciliaciones: readonly ConciliacionFila[];
}): IncidenciasDeSede {
  const porMoneda = new Map<string, bigint>();
  for (const cierre of datos.cierresDiarios) {
    if (DESCUADRE_JUSTIFICADO.has(String(cierre.aprobacionEstado ?? "").trim().toUpperCase())) {
      continue;
    }
    const menor = decimalToUnits(cierre.diferencia as never);
    if (menor === 0n) continue;
    porMoneda.set(cierre.monedaId, (porMoneda.get(cierre.monedaId) ?? 0n) + menor);
  }
  const descuadres = [...porMoneda.entries()]
    .map(([monedaId, menor]) => ({ monedaId, menor: Number(menor) }))
    .filter((d) => d.menor !== 0)
    .sort((a, b) => a.monedaId.localeCompare(b.monedaId));

  const arqueados = new Set(
    datos.cierresDiarios.map((c) => `${c.cuentaId}|${diaTexto(c.fechaNegocio)}`),
  );
  const conciliados = new Set(datos.conciliaciones.flatMap((c) => c.movimientoIds.map(String)));
  const movimientosPendientes = datos.movimientos.filter((movimiento) => {
    if (conciliados.has(movimiento.movimientoId)) return false;
    if (movimiento.requiereRevision) return true;
    if (!movimiento.cuentaId) return true;
    return !arqueados.has(`${movimiento.cuentaId}|${diaTexto(movimiento.fechaNegocio)}`);
  }).length;

  return { descuadres, movimientosPendientes };
}

/** La más reciente de varias fechas, ignorando las que no existen. */
export function ultimaNoticia(fechas: readonly (Date | null | undefined)[]): Date | null {
  const vivas = fechas.filter((f): f is Date => f instanceof Date && !Number.isNaN(f.getTime()));
  if (vivas.length === 0) return null;
  return vivas.reduce((mayor, fecha) => (fecha > mayor ? fecha : mayor));
}

export interface CierreDeLaSedePublicado {
  readonly origen: "MENSUAL" | "PERIODO";
  readonly estado: string;
  readonly cerrado_at: Date | null;
  readonly cerrado_por: string | null;
  readonly reabierto_at: Date | null;
}

/**
 * El semáforo de la cadena para un período.
 *
 * Solo sedes **activas**: una sede dada de baja no va a cerrar nada, y
 * exigírselo dejaría el consolidado imposible de firmar para siempre.
 */
export async function semaforoDeLaCadena(input: {
  readonly periodo: PeriodoDelSemaforo;
  readonly ahora: Date;
  readonly horasDeSilencioTolerables?: number;
}) {
  const { periodo } = input;
  const rango = { gte: periodo.fechaInicio, lt: periodo.fechaFinExclusiva };
  const sedes = await prisma.gym.findMany({
    where: { activo: true, deleted_at: null },
    select: { gym_id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
  const gymIds = sedes.map((sede) => sede.gym_id);
  if (gymIds.length === 0) {
    return {
      periodo,
      filas: [],
      puede_firmarse: false,
      ausentes: [] as Array<{ gym_id: string; nombre: string }>,
    };
  }

  const mensual = esMesNatural(periodo);
  const [cierresPeriodo, cierresMensuales, cierresDiarios, movimientos, conciliaciones, dispositivos] =
    await Promise.all([
      mensual
        ? Promise.resolve([] as any[])
        : prisma.tesoreriaCierrePeriodo.findMany({
            where: {
              gym_id: { in: gymIds },
              fecha_inicio: periodo.fechaInicio,
              fecha_fin_exclusiva: periodo.fechaFinExclusiva,
              is_deleted: false,
            },
            orderBy: { ciclo_numero: "asc" },
          }),
      mensual
        ? prisma.tesoreriaCierreMensual.findMany({
            where: { gym_id: { in: gymIds }, mes: mesDe(periodo), is_deleted: false },
            orderBy: { created_at: "asc" },
          })
        : Promise.resolve([] as any[]),
      prisma.tesoreriaCierre.findMany({
        where: { gym_id: { in: gymIds }, fecha_negocio: rango, is_deleted: false },
        select: {
          gym_id: true,
          cuenta_id: true,
          moneda_id: true,
          fecha_negocio: true,
          diferencia: true,
          aprobacion_estado: true,
        },
      }),
      prisma.tesoreriaMovimiento.findMany({
        where: { gym_id: { in: gymIds }, fecha_negocio: rango, is_deleted: false },
        select: {
          movimiento_id: true,
          gym_id: true,
          cuenta_id: true,
          fecha_negocio: true,
          requiere_revision: true,
        },
      }),
      prisma.tesoreriaConciliacion.findMany({
        where: { gym_id: { in: gymIds }, fecha_negocio: rango, is_deleted: false },
        select: { gym_id: true, movimiento_ids_json: true },
      }),
      prisma.device.findMany({
        where: { gym_id: { in: gymIds } },
        select: { device_id: true, gym_id: true, last_login_at: true, last_seen_at: true },
      }),
    ]);

  const estados = dispositivos.length
    ? await prisma.syncClientState.findMany({
        where: { device_id: { in: dispositivos.map((d) => d.device_id) } },
      })
    : [];
  const estadoPorDispositivo = new Map(estados.map((estado) => [estado.device_id, estado]));

  const noticiaPorSede = new Map<string, Date | null>();
  for (const sede of sedes) {
    const suyos = dispositivos.filter((d) => d.gym_id === sede.gym_id);
    noticiaPorSede.set(
      sede.gym_id,
      ultimaNoticia(
        suyos.flatMap((dispositivo) => {
          const estado = estadoPorDispositivo.get(dispositivo.device_id);
          return [
            dispositivo.last_login_at,
            dispositivo.last_seen_at,
            estado?.last_upload_at ?? null,
            estado?.last_server_sync_at ?? null,
            estado?.last_seen_at ?? null,
          ];
        }),
      ),
    );
  }

  const idsConciliados = conciliaciones.map((fila) => ({
    gymId: fila.gym_id,
    movimientoIds: parsearIds(fila.movimiento_ids_json),
  }));

  const entradas: EntradaDelSemaforo[] = [];
  const detallePorSede = new Map<
    string,
    { cierre: CierreDeLaSedePublicado | null; incidencias: IncidenciasDeSede }
  >();

  for (const sede of sedes) {
    const cierre = mensual
      ? elegirCierre(
          cierresMensuales
            .filter((fila) => fila.gym_id === sede.gym_id)
            .map((fila) => ({
              origen: "MENSUAL" as const,
              estado: fila.estado,
              cerrado_at: fila.cerrado_at,
              cerrado_por: fila.cerrado_por_nombre_snapshot,
              reabierto_at: fila.reabierto_at,
            })),
        )
      : elegirCierre(
          cierresPeriodo
            .filter((fila) => fila.gym_id === sede.gym_id)
            .map((fila) => ({
              origen: "PERIODO" as const,
              estado: fila.estado,
              cerrado_at: fila.cerrado_at,
              cerrado_por: fila.cerrado_por_nombre_snapshot,
              reabierto_at: fila.reabierto_at,
            })),
        );

    const incidencias = incidenciasDeLaSede({
      cierresDiarios: cierresDiarios
        .filter((fila) => fila.gym_id === sede.gym_id)
        .map((fila) => ({
          gymId: fila.gym_id,
          cuentaId: fila.cuenta_id,
          monedaId: fila.moneda_id,
          fechaNegocio: fila.fecha_negocio,
          diferencia: fila.diferencia,
          aprobacionEstado: fila.aprobacion_estado,
        })),
      movimientos: movimientos
        .filter((fila) => fila.gym_id === sede.gym_id)
        .map((fila) => ({
          movimientoId: fila.movimiento_id,
          gymId: fila.gym_id,
          cuentaId: fila.cuenta_id,
          fechaNegocio: fila.fecha_negocio,
          requiereRevision: fila.requiere_revision,
        })),
      conciliaciones: idsConciliados.filter((fila) => fila.gymId === sede.gym_id),
    });

    detallePorSede.set(sede.gym_id, { cierre, incidencias });
    entradas.push({
      gymId: sede.gym_id,
      cierre: cierre
        ? {
            estado: cierre.estado,
            descuadres: incidencias.descuadres,
            movimientosPendientes: incidencias.movimientosPendientes,
          }
        : null,
      ultimaSincronizacion: noticiaPorSede.get(sede.gym_id) ?? null,
      ahora: input.ahora,
      horasDeSilencioTolerables: input.horasDeSilencioTolerables,
    });
  }

  const consolidado = consolidarSemaforo(entradas);
  const nombrePorSede = new Map(sedes.map((sede) => [sede.gym_id, sede.nombre]));

  return {
    periodo,
    filas: consolidado.filas.map((fila) => {
      const detalle = detallePorSede.get(fila.gymId);
      return {
        gym_id: fila.gymId,
        nombre: nombrePorSede.get(fila.gymId) ?? fila.gymId,
        estado: fila.estado,
        consolidable: fila.consolidable,
        motivo: fila.motivo,
        cierre: detalle?.cierre ?? null,
        // En `snake_case` como el resto de la API. La política los nombra en
        // camelCase porque allí son dominio; el borde HTTP habla el idioma del
        // borde, y mezclarlos obliga al cliente a recordar cuál es cuál.
        descuadres: (detalle?.incidencias.descuadres ?? []).map((d) => ({
          moneda_id: d.monedaId,
          menor: d.menor,
        })),
        movimientos_pendientes: detalle?.incidencias.movimientosPendientes ?? 0,
        ultima_noticia: noticiaPorSede.get(fila.gymId) ?? null,
      };
    }),
    puede_firmarse: consolidado.puedeFirmarse,
    // Nombradas, no contadas: §6.2 exige poder declarar quién falta.
    ausentes: consolidado.ausentes.map((gymId) => ({
      gym_id: gymId,
      nombre: nombrePorSede.get(gymId) ?? gymId,
    })),
  };
}

/**
 * Un mismo rango admite más de un cierre —`SEMANAL` y `PERSONALIZADO` sobre las
 * mismas fechas, o varios ciclos tras una reapertura—. Manda el que está
 * `CERRADO`: si existe, la sede tiene ese período firmado. Si no hay ninguno,
 * se enseña el último que hubo, que es el que explica por qué no consolida.
 */
function elegirCierre(
  cierres: readonly CierreDeLaSedePublicado[],
): CierreDeLaSedePublicado | null {
  if (cierres.length === 0) return null;
  return cierres.find((cierre) => cierre.estado === "CERRADO") ?? cierres[cierres.length - 1];
}

function parsearIds(valor: string): string[] {
  try {
    const parseado = JSON.parse(valor);
    return Array.isArray(parseado) ? parseado.map(String) : [];
  } catch {
    return [];
  }
}
