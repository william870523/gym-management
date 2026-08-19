/**
 * M6 — el informe agregado de la cadena (docs/MULTI_SEDE.md §6.3 y §6.4).
 *
 * §6.4 distingue tres cosas que es fácil confundir: el **detalle por sede**, el
 * **informe agregado** —que se puede mirar cuando se quiera y cambia si llegan
 * datos nuevos— y el **certificado firmado**, que congela una foto y ya no
 * cambia. Esto es el segundo: un informe, no un certificado. Firmarlo es la
 * unidad siguiente y necesita su propia tabla.
 *
 * ## Quién entra, lo decide el semáforo de M5
 *
 * No se vuelve a razonar aquí qué sede consolida: se le pregunta a
 * `semaforoDeLaCadena`, que ya sabe distinguir `CERRADA_Y_SINCRONIZADA` de
 * `CON_INCIDENCIAS`, `SIN_CERRAR` y `SIN_NOTICIAS`, y que ya sabe que un cierre
 * `REABIERTO` no cuenta. Duplicar ese criterio aquí es la manera segura de que
 * dentro de tres meses el semáforo diga verde y el consolidado deje a esa sede
 * fuera, o al contrario.
 *
 * Las que no consolidan entran como **ausentes con su motivo** —el mismo texto
 * que el semáforo publica—, y eso es lo que convierte el total en un cierre
 * parcial declarado en vez de un total silencioso e incompleto.
 */
import { prisma } from "../../infrastructure/db/prismaClient";
import {
  consolidarCadena,
  motivoParaNoFirmar,
  type AporteDeSede,
  type SedeAusente,
} from "../../domain/consolidado-cadena-policy";
import {
  aporteDesdeCierreMensual,
  aporteDesdeCierrePeriodo,
  unirTraducciones,
} from "./aportes-desde-cierres";
import {
  esMesNatural,
  mesDe,
  semaforoDeLaCadena,
  type PeriodoDelSemaforo,
} from "./semaforo-cierre.service";

export async function consolidadoDeLaCadena(input: {
  readonly periodo: PeriodoDelSemaforo;
  readonly ahora: Date;
  readonly horasDeSilencioTolerables?: number;
}) {
  const semaforo = await semaforoDeLaCadena(input);
  const consolidables = semaforo.filas.filter((fila) => fila.consolidable);
  const ausentes: SedeAusente[] = semaforo.filas
    .filter((fila) => !fila.consolidable)
    .map((fila) => ({ gymId: fila.gym_id, motivo: fila.motivo }));

  const mensual = esMesNatural(input.periodo);
  const gymIds = consolidables.map((fila) => fila.gym_id);

  // Los snapshots no los trae el semáforo —engordarían su respuesta sin que
  // nadie los mire allí—, así que se leen aquí, y solo de las sedes que sí
  // consolidan.
  const traducciones = [];
  if (gymIds.length > 0 && mensual) {
    const filas = await prisma.tesoreriaCierreMensual.findMany({
      where: {
        gym_id: { in: gymIds },
        mes: mesDe(input.periodo),
        estado: "CERRADO",
        is_deleted: false,
      },
      select: { gym_id: true, resumen_snapshot_json: true },
    });
    for (const fila of filas) {
      traducciones.push(
        aporteDesdeCierreMensual({
          gymId: fila.gym_id,
          snapshotJson: fila.resumen_snapshot_json,
        }),
      );
    }
  } else if (gymIds.length > 0) {
    const filas = await prisma.tesoreriaCierrePeriodo.findMany({
      where: {
        gym_id: { in: gymIds },
        fecha_inicio: input.periodo.fechaInicio,
        fecha_fin_exclusiva: input.periodo.fechaFinExclusiva,
        estado: "CERRADO",
        is_deleted: false,
      },
      select: { gym_id: true, snapshot_json: true },
    });
    for (const fila of filas) {
      traducciones.push(
        aporteDesdeCierrePeriodo({
          gymId: fila.gym_id,
          snapshotJson: fila.snapshot_json,
        }),
      );
    }
  }

  const traducido = unirTraducciones(traducciones);
  const consolidado = consolidarCadena({
    aportes: traducido.aportes as AporteDeSede[],
    ausentes,
  });
  const nombrePorSede = new Map(semaforo.filas.map((fila) => [fila.gym_id, fila.nombre]));
  // El código de la moneda sale del propio cierre, congelado con él. Solo se
  // pregunta al catálogo por las que ningún cierre nombró, y si tampoco está,
  // se enseña el identificador antes que una casilla vacía.
  const sinCodigo = consolidado.monedas
    .map((bloque) => bloque.monedaId)
    .filter((monedaId) => !traducido.codigos[monedaId]);
  const delCatalogo = sinCodigo.length
    ? await prisma.moneda.findMany({
        where: { moneda_id: { in: sinCodigo } },
        select: { moneda_id: true, codigo: true },
      })
    : [];
  const codigoDe = (monedaId: string) =>
    traducido.codigos[monedaId] ??
    delCatalogo.find((fila) => fila.moneda_id === monedaId)?.codigo ??
    monedaId;

  return {
    periodo: input.periodo,
    clase: consolidado.clase,
    monedas: consolidado.monedas.map((bloque) => ({
      moneda_id: bloque.monedaId,
      moneda_codigo: codigoDe(bloque.monedaId),
      // El dinero sale en unidades menores **y** con sus dos decimales: el
      // entero es lo que se suma sin redondeos y el texto es lo que se lee.
      ingreso_menor: bloque.ingresoMenor,
      ingreso: (bloque.ingresoMenor / 100).toFixed(2),
      cobrado_cuenta_ajena_menor: bloque.cobradoPorCuentaAjenaMenor,
      cobrado_cuenta_ajena: (bloque.cobradoPorCuentaAjenaMenor / 100).toFixed(2),
      sedes: bloque.sedes.map((sede) => ({
        gym_id: sede.gymId,
        nombre: nombrePorSede.get(sede.gymId) ?? sede.gymId,
        ingreso_menor: sede.ingresoMenor,
        ingreso: (sede.ingresoMenor / 100).toFixed(2),
        cobrado_cuenta_ajena_menor: sede.cobradoPorCuentaAjenaMenor,
        cobrado_cuenta_ajena: (sede.cobradoPorCuentaAjenaMenor / 100).toFixed(2),
        origen_cierre: sede.origenCierre,
      })),
    })),
    ausentes: consolidado.ausentes.map((sede) => ({
      gym_id: sede.gymId,
      nombre: nombrePorSede.get(sede.gymId) ?? sede.gymId,
      motivo: sede.motivo,
    })),
    sedes_incluidas: consolidado.sedesIncluidas,
    // Lo que estos cierres no pueden afirmar. Va en la respuesta y no en un log:
    // quien firme tiene que verlo.
    avisos: traducido.avisos,
    motivo_para_no_firmar: motivoParaNoFirmar(consolidado),
    // Nunca hay un total general: §6.3 y la política no dejan sitio para uno.
    nota: "No suma monedas distintas. El dinero cobrado por cuenta ajena va aparte del ingreso.",
  };
}
