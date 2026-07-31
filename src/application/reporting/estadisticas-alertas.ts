import {
  compararMetrica,
  type ComparacionMetrica,
  type IndicadoresAlerta,
  type RankingEntrenador,
  type RankingPlan,
  type ResumenRankings,
  type TipoRanking,
} from "./estadisticas-rankings.reader";

/**
 * Alertas explicables de la portada (docs/PLAN_ESTADISTICAS.md §5.1).
 *
 * Tres decisiones gobiernan este módulo:
 *
 *  - **ninguna alerta recomienda nada.** Cada una publica el umbral que la
 *    disparó, su denominador y el destino donde comprobarla. Un aviso sin su
 *    regla a la vista es una opinión, no una estadística;
 *  - **el motor es puro.** Recibe lo que la portada ya leyó y no consulta la
 *    base, así SQLite y MariaDB pueden diferir en el dato pero nunca en el
 *    criterio;
 *  - **nada se dispara con muestra insuficiente.** Cada familia exige una base
 *    mínima en el bloque anterior; por debajo de ella la regla se declara no
 *    evaluada, que no es lo mismo que «todo en orden» (regla 7 del plan).
 */

export type SeveridadAlerta = "aviso" | "peligro";

export type FamiliaAlerta =
  | "asistencia"
  | "mora"
  | "plan"
  | "entrenador"
  | "datos";

export interface DestinoAlerta {
  tipo: "ranking" | "plan" | "entrenador";
  ranking?: TipoRanking;
  id?: string;
  monedaId?: string;
}

export interface MuestraAlerta {
  /** Numerador de la tasa mostrada. */
  valor: number;
  /** Denominador: sin él ningún porcentaje puede leerse (regla 7). */
  base: number;
  etiqueta: string;
}

export interface AlertaEstadistica {
  id: string;
  familia: FamiliaAlerta;
  severidad: SeveridadAlerta;
  titulo: string;
  detalle: string;
  regla: string;
  comparacion: ComparacionMetrica | null;
  muestra: MuestraAlerta | null;
  monedaId: string | null;
  destino: DestinoAlerta | null;
}

export interface ReglaAlerta {
  familia: FamiliaAlerta;
  texto: string;
}

export interface ResultadoAlertas {
  alertas: AlertaEstadistica[];
  /** Avisos de la misma familia que no caben en el panel, ya contados. */
  omitidas: number;
  /** Las reglas evaluadas, se hayan disparado o no. */
  reglas: ReglaAlerta[];
}

export const UMBRALES_ALERTA = {
  /** Máximo de avisos por familia; el resto se cuenta en `omitidas`. */
  porFamilia: 3,
  asistencia: { aviso: 15, peligro: 30, baseMinima: 30 },
  mora: { aviso: 25, peligro: 50, baseMinima: 5 },
  plan: { aviso: 30, peligro: 50, baseMinima: 5 },
  entrenador: { aviso: 20, peligro: 40, baseMinima: 5 },
  datos: { coberturaAviso: 90, coberturaPeligro: 75, sinSexoAviso: 10 },
} as const;

const REGLAS: ReglaAlerta[] = [
  {
    familia: "asistencia",
    texto:
      `Asistencia: se avisa cuando las visitas del período caen ` +
      `${UMBRALES_ALERTA.asistencia.aviso} % o más frente al bloque anterior ` +
      `de igual duración (peligro desde ` +
      `${UMBRALES_ALERTA.asistencia.peligro} %). No se evalúa con menos de ` +
      `${UMBRALES_ALERTA.asistencia.baseMinima} visitas en el bloque anterior.`,
  },
  {
    familia: "mora",
    texto:
      `Mora: se avisa, por moneda y sin sumarlas, cuando el recargo cobrado ` +
      `sube ${UMBRALES_ALERTA.mora.aviso} % o más (peligro desde ` +
      `${UMBRALES_ALERTA.mora.peligro} %). No se evalúa con menos de ` +
      `${UMBRALES_ALERTA.mora.baseMinima} cobros con recargo en el bloque ` +
      `anterior.`,
  },
  {
    familia: "plan",
    texto:
      `Planes: se avisa cuando la contratación de un plan cae ` +
      `${UMBRALES_ALERTA.plan.aviso} % o más (peligro desde ` +
      `${UMBRALES_ALERTA.plan.peligro} %), con al menos ` +
      `${UMBRALES_ALERTA.plan.baseMinima} contratos en el bloque anterior. ` +
      `El churn por plan no se juzga aquí: espera al motor canónico de ` +
      `cohortes maduras (regla 11 del plan).`,
  },
  {
    familia: "entrenador",
    texto:
      `Entrenadores: se avisa cuando la cartera activa cae ` +
      `${UMBRALES_ALERTA.entrenador.aviso} % o más respecto al corte ` +
      `anterior (peligro desde ${UMBRALES_ALERTA.entrenador.peligro} %), con ` +
      `al menos ${UMBRALES_ALERTA.entrenador.baseMinima} socios en aquel ` +
      `corte.`,
  },
  {
    familia: "datos",
    texto:
      `Datos: se avisa cuando la fecha de nacimiento cubre menos del ` +
      `${UMBRALES_ALERTA.datos.coberturaAviso} % del padrón (peligro por ` +
      `debajo del ${UMBRALES_ALERTA.datos.coberturaPeligro} %), cuando falta ` +
      `el sexo en más del ${UMBRALES_ALERTA.datos.sinSexoAviso} % o cuando ` +
      `el mismo sexo aparece escrito de más de dos formas.`,
  },
];

const SIN_DATO = "SIN DATO";

function entero(valor: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 })
    .format(valor);
}

function importe(valor: number) {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

function porcentaje(valor: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 })
    .format(valor);
}

/** Caída porcentual positiva; `null` si no hay base o si no cayó. */
function caida(actual: number, anterior: number) {
  if (anterior <= 0 || actual >= anterior) return null;
  return ((anterior - actual) / anterior) * 100;
}

/** Subida porcentual positiva; `null` si no hay base o si no subió. */
function subida(actual: number, anterior: number) {
  if (anterior <= 0 || actual <= anterior) return null;
  return ((actual - anterior) / anterior) * 100;
}

function severidad(
  magnitud: number,
  umbrales: { aviso: number; peligro: number },
): SeveridadAlerta | null {
  if (magnitud >= umbrales.peligro) return "peligro";
  if (magnitud >= umbrales.aviso) return "aviso";
  return null;
}

const PESO_SEVERIDAD: Record<SeveridadAlerta, number> = {
  peligro: 0,
  aviso: 1,
};

function magnitudDe(alerta: AlertaEstadistica) {
  return Math.abs(alerta.comparacion?.variacionPorcentual ?? 0);
}

/**
 * Recorta cada familia a `porFamilia` avisos, conservando los más graves, y
 * devuelve cuántos quedaron fuera. Un panel con cuarenta tarjetas no se lee:
 * lo que no cabe se cuenta, no se esconde.
 */
function recortarPorFamilia(alertas: AlertaEstadistica[]) {
  const vistas = new Map<FamiliaAlerta, number>();
  const conservadas: AlertaEstadistica[] = [];
  let omitidas = 0;
  for (const alerta of alertas) {
    const cuantas = vistas.get(alerta.familia) ?? 0;
    if (cuantas >= UMBRALES_ALERTA.porFamilia) {
      omitidas += 1;
      continue;
    }
    vistas.set(alerta.familia, cuantas + 1);
    conservadas.push(alerta);
  }
  return { conservadas, omitidas };
}

export function calcularAlertas(entrada: {
  resumen: ResumenRankings;
  indicadores: IndicadoresAlerta;
  /** Todos los planes del catálogo, no solo el Top 5 de la portada. */
  planes: RankingPlan[];
  /** Todos los entrenadores, por la misma razón. */
  entrenadores: RankingEntrenador[];
}): ResultadoAlertas {
  const alertas: AlertaEstadistica[] = [];

  const visitas = entrada.indicadores.visitas;
  if (visitas.anterior >= UMBRALES_ALERTA.asistencia.baseMinima) {
    const magnitud = caida(visitas.actual, visitas.anterior);
    const nivel = magnitud === null
      ? null
      : severidad(magnitud, UMBRALES_ALERTA.asistencia);
    if (magnitud !== null && nivel) {
      alertas.push({
        id: "asistencia-caida",
        familia: "asistencia",
        severidad: nivel,
        titulo: "La asistencia cae",
        detalle:
          `Se registraron ${entero(visitas.actual)} visitas frente a ` +
          `${entero(visitas.anterior)} del bloque anterior: ` +
          `${porcentaje(magnitud)} % menos.`,
        regla: REGLAS[0]!.texto,
        comparacion: compararMetrica(
          "visitas",
          visitas.actual,
          visitas.anterior,
        ),
        muestra: {
          valor: visitas.actual,
          base: visitas.anterior,
          etiqueta: "visitas del período sobre las del anterior",
        },
        monedaId: null,
        destino: { tipo: "ranking", ranking: "socios-inactividad" },
      });
    }
  }

  for (const mora of entrada.indicadores.mora) {
    if (mora.cobrosAnterior < UMBRALES_ALERTA.mora.baseMinima) continue;
    const magnitud = subida(mora.importeActual, mora.importeAnterior);
    const nivel = magnitud === null
      ? null
      : severidad(magnitud, UMBRALES_ALERTA.mora);
    if (magnitud === null || !nivel) continue;
    alertas.push({
      id: `mora-aumento:${mora.monedaId}`,
      familia: "mora",
      severidad: nivel,
      titulo: "Sube el recargo de mora",
      detalle:
        `El recargo cobrado pasó de ${importe(mora.importeAnterior)} a ` +
        `${importe(mora.importeActual)} (${porcentaje(magnitud)} % más) en ` +
        `${entero(mora.cobrosActual)} cobros, frente a ` +
        `${entero(mora.cobrosAnterior)} antes.`,
      regla: REGLAS[1]!.texto,
      comparacion: compararMetrica(
        "recargoMora",
        mora.importeActual,
        mora.importeAnterior,
      ),
      muestra: {
        valor: mora.cobrosActual,
        base: mora.cobrosAnterior,
        etiqueta: "cobros con recargo sobre los del bloque anterior",
      },
      monedaId: mora.monedaId,
      // Todavía no existe un ranking de mora: el detalle por persona vive en
      // la Puntualidad del perfil de cada socio. Antes que un destino que no
      // explica la cifra, ninguno.
      destino: null,
    });
  }

  for (const plan of entrada.planes) {
    if (plan.vendidosAnterior < UMBRALES_ALERTA.plan.baseMinima) continue;
    const magnitud = caida(plan.vendidos, plan.vendidosAnterior);
    const nivel = magnitud === null
      ? null
      : severidad(magnitud, UMBRALES_ALERTA.plan);
    if (magnitud === null || !nivel) continue;
    alertas.push({
      id: `plan-contratacion-caida:${plan.id}`,
      familia: "plan",
      severidad: nivel,
      titulo: `Cae la contratación de ${plan.nombre}`,
      detalle:
        `Se contrató ${entero(plan.vendidos)} veces frente a ` +
        `${entero(plan.vendidosAnterior)} en el bloque anterior: ` +
        `${porcentaje(magnitud)} % menos.`,
      regla: REGLAS[2]!.texto,
      comparacion: compararMetrica(
        "vendidos",
        plan.vendidos,
        plan.vendidosAnterior,
      ),
      muestra: {
        valor: plan.vendidos,
        base: plan.vendidosAnterior,
        etiqueta: "contratos del período sobre los del anterior",
      },
      monedaId: null,
      destino: { tipo: "plan", id: plan.id },
    });
  }

  for (const entrenador of entrada.entrenadores) {
    if (
      entrenador.carteraActivaAnterior < UMBRALES_ALERTA.entrenador.baseMinima
    ) {
      continue;
    }
    const magnitud = caida(
      entrenador.carteraActiva,
      entrenador.carteraActivaAnterior,
    );
    const nivel = magnitud === null
      ? null
      : severidad(magnitud, UMBRALES_ALERTA.entrenador);
    if (magnitud === null || !nivel) continue;
    alertas.push({
      id: `entrenador-cartera-caida:${entrenador.id}`,
      familia: "entrenador",
      severidad: nivel,
      titulo: `La cartera de ${entrenador.nombre} se reduce`,
      detalle:
        `Atiende a ${entero(entrenador.carteraActiva)} socios frente a ` +
        `${entero(entrenador.carteraActivaAnterior)} en el corte anterior: ` +
        `${porcentaje(magnitud)} % menos. Perdió ` +
        `${entero(entrenador.perdidos)} y ganó ` +
        `${entero(entrenador.ganados)} en el período.`,
      regla: REGLAS[3]!.texto,
      comparacion: compararMetrica(
        "carteraActiva",
        entrenador.carteraActiva,
        entrenador.carteraActivaAnterior,
      ),
      muestra: {
        valor: entrenador.carteraActiva,
        base: entrenador.carteraActivaAnterior,
        etiqueta: "socios de la cartera sobre los del corte anterior",
      },
      monedaId: null,
      destino: { tipo: "entrenador", id: entrenador.id },
    });
  }

  const padron = entrada.resumen.sociosRegistrados;
  if (padron > 0) {
    const conFecha = padron - entrada.resumen.sinFechaNacimiento;
    const cobertura = (conFecha / padron) * 100;
    const nivelFecha = cobertura < UMBRALES_ALERTA.datos.coberturaPeligro
      ? "peligro"
      : cobertura < UMBRALES_ALERTA.datos.coberturaAviso
      ? "aviso"
      : null;
    if (nivelFecha) {
      alertas.push({
        id: "datos-fecha-nacimiento",
        familia: "datos",
        severidad: nivelFecha,
        titulo: "Falta fecha de nacimiento",
        detalle:
          `${entero(entrada.resumen.sinFechaNacimiento)} socios no la tienen. ` +
          `La segmentación por edad solo cubre ${porcentaje(cobertura)} % del ` +
          `padrón y el resto se cuenta aparte, nunca se reparte.`,
        regla: REGLAS[4]!.texto,
        comparacion: null,
        muestra: {
          valor: conFecha,
          base: padron,
          etiqueta: "socios con fecha sobre el padrón",
        },
        monedaId: null,
        destino: null,
      });
    }

    const sinSexo = entrada.resumen.porSexo
      .filter((fila) => fila.etiqueta === SIN_DATO)
      .reduce((suma, fila) => suma + fila.total, 0);
    const etiquetasSexo = entrada.resumen.porSexo
      .filter((fila) => fila.etiqueta !== SIN_DATO).length;
    const faltaSexo = (sinSexo / padron) * 100;
    if (faltaSexo > UMBRALES_ALERTA.datos.sinSexoAviso || etiquetasSexo > 2) {
      alertas.push({
        id: "datos-sexo",
        familia: "datos",
        severidad: "aviso",
        titulo: etiquetasSexo > 2
          ? "El sexo está escrito de varias formas"
          : "Falta el sexo",
        detalle: etiquetasSexo > 2
          ? `Hay ${entero(etiquetasSexo)} formas distintas de escribirlo y ` +
            `${entero(sinSexo)} socios sin dato: agrupar por sexo produce ` +
            `categorías duplicadas hasta normalizarlo.`
          : `${entero(sinSexo)} socios no lo tienen, el ` +
            `${porcentaje(faltaSexo)} % del padrón.`,
        regla: REGLAS[4]!.texto,
        comparacion: null,
        muestra: {
          valor: padron - sinSexo,
          base: padron,
          etiqueta: "socios con sexo sobre el padrón",
        },
        monedaId: null,
        destino: null,
      });
    }
  }

  alertas.sort((a, b) =>
    PESO_SEVERIDAD[a.severidad] - PESO_SEVERIDAD[b.severidad] ||
    magnitudDe(b) - magnitudDe(a) ||
    a.titulo.localeCompare(b.titulo) ||
    a.id.localeCompare(b.id)
  );

  const { conservadas, omitidas } = recortarPorFamilia(alertas);
  return { alertas: conservadas, omitidas, reglas: REGLAS };
}
