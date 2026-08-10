import type {
  EstadisticasCalidadReader,
  RetencionBajasReader,
} from "./estadisticas-calidad.reader";

const DIA_MS = 86_400_000;

export const PERIODOS_CALIDAD = [30, 90, 365] as const;
export type PeriodoCalidad = (typeof PERIODOS_CALIDAD)[number];

export class ConsultaCalidadInvalida extends Error {}

/** Clave con la que el cruzador agrupa lo que no tiene valor. */
const SIN_DATO = "SIN DATO";

export type SeveridadCalidad = "ok" | "aviso" | "peligro";

export type FamiliaCalidad =
  | "socios"
  | "membresias"
  | "asistencias"
  | "cobros"
  | "bajas";

/**
 * A dónde lleva un control cuando existe un sitio donde arreglarlo.
 *
 * Cuando no existe se devuelve `null` y se dice por qué, igual que hace la
 * alerta de mora: antes que un destino que no explica la cifra, ninguno.
 */
export type DestinoCalidad =
  | { tipo: "clientes"; atributo: "sexo" | "referencia" | "horario"; valor: string }
  | { tipo: "retencion" };

export interface ControlCalidad {
  id: string;
  familia: FamiliaCalidad;
  titulo: string;
  /** Qué significa el hueco y qué conclusiones deja de sostener. */
  detalle: string;
  /** El criterio con el que se juzgó, a la vista (nunca una nota sin regla). */
  regla: string;
  afectados: number;
  base: number;
  /** `(base - afectados) / base`. `null` cuando no hay base que medir. */
  coberturaPct: number | null;
  severidad: SeveridadCalidad;
  destino: DestinoCalidad | null;
}

export const UMBRALES_CALIDAD = {
  /** Por debajo de esta cobertura el indicador ya no se lee tranquilo. */
  coberturaAviso: 95,
  coberturaPeligro: 80,
} as const;

const REGLA_COBERTURA =
  `Cobertura: aviso por debajo del ${UMBRALES_CALIDAD.coberturaAviso} % de ` +
  `los registros con el dato, peligro por debajo del ` +
  `${UMBRALES_CALIDAD.coberturaPeligro} %.`;

// Una incoherencia estructural no se gradúa por porcentaje: una sola membresía
// con las fechas invertidas describe una cobertura imposible, y mil filas
// correctas no la compensan.
const REGLA_INCOHERENCIA =
  "Incoherencia estructural: cualquier caso es peligro, porque describe un " +
  "estado que no puede existir. No se gradúa por porcentaje.";

function porcentaje(numerador: number, denominador: number): number | null {
  return denominador === 0
    ? null
    : Math.round((numerador / denominador) * 10_000) / 100;
}

export function severidadPorCobertura(
  afectados: number,
  base: number,
): SeveridadCalidad {
  if (base === 0 || afectados === 0) return "ok";
  const cobertura = ((base - afectados) / base) * 100;
  if (cobertura < UMBRALES_CALIDAD.coberturaPeligro) return "peligro";
  if (cobertura < UMBRALES_CALIDAD.coberturaAviso) return "aviso";
  return "ok";
}

function control(input: {
  id: string;
  familia: FamiliaCalidad;
  titulo: string;
  detalle: string;
  regla?: string;
  afectados: number;
  base: number;
  /** `false` cuando la cobertura no es la lente correcta para ese control. */
  cobertura?: boolean;
  severidad?: SeveridadCalidad;
  destino?: DestinoCalidad | null;
}): ControlCalidad {
  return {
    id: input.id,
    familia: input.familia,
    titulo: input.titulo,
    detalle: input.detalle,
    regla: input.regla ?? REGLA_COBERTURA,
    afectados: input.afectados,
    base: input.base,
    coberturaPct: input.cobertura === false
      ? null
      : porcentaje(input.base - input.afectados, input.base),
    severidad: input.severidad
      ?? severidadPorCobertura(input.afectados, input.base),
    destino: input.destino ?? null,
  };
}

/** Incoherencia estructural: cualquier caso es peligro; ninguno, `ok`. */
function incoherencia(input: {
  id: string;
  familia: FamiliaCalidad;
  titulo: string;
  detalle: string;
  afectados: number;
  base: number;
  cobertura?: boolean;
  destino?: DestinoCalidad | null;
}): ControlCalidad {
  return control({
    ...input,
    regla: REGLA_INCOHERENCIA,
    severidad: input.afectados > 0 ? "peligro" : "ok",
  });
}

const PESO_SEVERIDAD: Record<SeveridadCalidad, number> = {
  peligro: 0,
  aviso: 1,
  ok: 2,
};

function entero(valor: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 })
    .format(valor);
}

export class EstadisticasCalidadService {
  constructor(
    private readonly reader: EstadisticasCalidadReader,
    /** Sin él la familia «bajas» se declara no evaluada, nunca en cero. */
    private readonly retencion?: RetencionBajasReader,
  ) {}

  async calidad(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    dias: number;
  }) {
    if (!PERIODOS_CALIDAD.includes(input.dias as PeriodoCalidad)) {
      throw new ConsultaCalidadInvalida(
        "El período debe ser 30, 90 o 365 días.",
      );
    }

    const hoy = new Date(Date.UTC(
      input.hoy.getUTCFullYear(),
      input.hoy.getUTCMonth(),
      input.hoy.getUTCDate(),
    ));
    const hastaExclusiva = new Date(hoy.getTime() + DIA_MS);
    const desde = new Date(hastaExclusiva.getTime() - input.dias * DIA_MS);

    const [socios, membresias, asistencias, cobros] = await Promise.all([
      this.reader.leerSocios(input.gymId),
      this.reader.leerMembresias(input.gymId),
      this.reader.leerAsistencias(input.gymId),
      this.reader.leerCobros(input.gymId),
    ]);

    const controles: ControlCalidad[] = [
      control({
        id: "socios-fecha-nacimiento",
        familia: "socios",
        titulo: "Socios sin fecha de nacimiento",
        detalle:
          `${entero(socios.sinFechaNacimiento)} de ${entero(socios.padron)} ` +
          "socios no la tienen. Cualquier lectura por edad los cuenta aparte, " +
          "nunca los reparte. Con carné cubano la deriva el servidor; los de " +
          "pasaporte se completan al editar la ficha.",
        afectados: socios.sinFechaNacimiento,
        base: socios.padron,
        // No hay filtro de Clientes por este campo, así que no se promete uno.
        destino: null,
      }),
      control({
        id: "socios-sexo",
        familia: "socios",
        titulo: "Socios sin sexo registrado",
        detalle:
          `${entero(socios.sinSexo)} socios sin dato. Agrupar por sexo deja ` +
          "fuera a esos, y el reparto porcentual del resto no los representa.",
        afectados: socios.sinSexo,
        base: socios.padron,
        destino: socios.sinSexo > 0
          ? { tipo: "clientes", atributo: "sexo", valor: SIN_DATO }
          : null,
      }),
      incoherencia({
        id: "socios-sexo-vocabulario",
        familia: "socios",
        titulo: "El sexo escrito de varias formas",
        detalle: socios.variantesSexo.length > 3
          ? `Conviven ${entero(socios.variantesSexo.length)} formas ` +
            `(${socios.variantesSexo.join(", ")}): agrupar por sexo produce ` +
            "categorías duplicadas. El vocabulario válido es Masculino, " +
            "Femenino y Otro, y lo decide el servidor."
          : `Vocabulario correcto: ${
            socios.variantesSexo.join(", ") || "sin socios"
          }.`,
        // Tres son las formas legítimas; a partir de la cuarta hay duplicado.
        afectados: Math.max(0, socios.variantesSexo.length - 3),
        base: socios.variantesSexo.length,
        // Aquí la cobertura no dice nada: lo que falla no es cuántas filas
        // tienen el dato, sino con cuántas palabras se escribió el mismo valor.
        cobertura: false,
        destino: null,
      }),
      control({
        id: "socios-referencia",
        familia: "socios",
        titulo: "Socios sin canal de captación",
        detalle:
          `${entero(socios.sinReferencia)} socios sin referencia. La lectura ` +
          "de captación no puede atribuirlos a ningún canal.",
        afectados: socios.sinReferencia,
        base: socios.padron,
        destino: socios.sinReferencia > 0
          ? { tipo: "clientes", atributo: "referencia", valor: SIN_DATO }
          : null,
      }),
      control({
        id: "socios-horario",
        familia: "socios",
        titulo: "Socios sin franja declarada",
        detalle:
          `${entero(socios.sinHorario)} socios sin horario en la ficha. El ` +
          "cruce entre franja declarada y observada no los puede comparar.",
        afectados: socios.sinHorario,
        base: socios.padron,
        destino: socios.sinHorario > 0
          ? { tipo: "clientes", atributo: "horario", valor: SIN_DATO }
          : null,
      }),
      incoherencia({
        id: "membresias-solapadas",
        familia: "membresias",
        titulo: "Membresías solapadas",
        detalle:
          `${entero(membresias.solapadas)} contratos pisan la cobertura de ` +
          "otro del mismo socio. La atribución de visitas a un plan deja de " +
          "ser única mientras exista el solape (regla 10).",
        afectados: membresias.solapadas,
        base: membresias.total,
      }),
      incoherencia({
        id: "membresias-fechas-invertidas",
        familia: "membresias",
        titulo: "Membresías con las fechas invertidas",
        detalle:
          `${entero(membresias.fechasInvertidas)} contratos terminan antes de ` +
          "empezar. No cubren ningún día y falsean toda antigüedad.",
        afectados: membresias.fechasInvertidas,
        base: membresias.total,
      }),
      incoherencia({
        id: "membresias-sin-plan",
        familia: "membresias",
        titulo: "Membresías sin plan resoluble",
        detalle:
          `${entero(membresias.sinPlanResoluble)} contratos apuntan a un plan ` +
          "que ya no está en el catálogo. El nombre congelado sigue siendo " +
          "cierto, pero el perfil de ese plan no las puede contar.",
        afectados: membresias.sinPlanResoluble,
        base: membresias.total,
      }),
      incoherencia({
        id: "asistencias-sin-instante",
        familia: "asistencias",
        titulo: "Entradas sin instante válido",
        detalle:
          `${entero(asistencias.sinInstante)} entradas no se pueden situar en ` +
          "ningún día ni hora, así que quedan fuera del mapa de demanda.",
        afectados: asistencias.sinInstante,
        base: asistencias.total,
      }),
      control({
        id: "asistencias-abiertas",
        familia: "asistencias",
        titulo: "Entradas abiertas anormalmente",
        detalle:
          `${entero(asistencias.abiertasAnomalas)} entradas llevan más de ` +
          `${asistencias.umbralHorasAbierta} horas sin salida registrada. La ` +
          "permanencia media no las puede usar.",
        regla:
          `Permanencia: se señala toda entrada sin salida pasadas ` +
          `${asistencias.umbralHorasAbierta} horas. ` + REGLA_COBERTURA,
        afectados: asistencias.abiertasAnomalas,
        base: asistencias.total,
      }),
      incoherencia({
        id: "cobros-sin-moneda",
        familia: "cobros",
        titulo: "Cobros sin moneda",
        detalle:
          `${entero(cobros.sinMoneda)} cobros no dicen en qué moneda entraron. ` +
          "Sin moneda un importe no se puede sumar con ningún otro.",
        afectados: cobros.sinMoneda,
        base: cobros.total,
      }),
      control({
        id: "cobros-sin-medio",
        familia: "cobros",
        titulo: "Cobros sin medio de pago",
        detalle:
          `${entero(cobros.sinMedio)} cobros no tienen ningún movimiento de ` +
          "detalle: no se sabe por qué medio ni a qué cuenta entró el dinero.",
        afectados: cobros.sinMedio,
        base: cobros.total,
      }),
      control({
        id: "cobros-sin-cobrador",
        familia: "cobros",
        titulo: "Cobros sin cobrador atribuido",
        detalle:
          `${entero(cobros.sinCobrador)} cobros sin atribución de recepción. ` +
          "Es historia anterior a R5.6 y se muestra como «sin atribuir»; todo " +
          "cobro nuevo exige actor autenticado.",
        afectados: cobros.sinCobrador,
        base: cobros.total,
      }),
    ];

    let bajas: {
      evaluada: boolean;
      motivo: string | null;
      total: number;
      corteMadurez: string | null;
    } = {
      evaluada: false,
      motivo:
        "La familia «bajas» necesita el motor canónico de retención y esta " +
        "instalación no lo tiene conectado. No se cuenta por otra vía: la " +
        "regla 11 del plan reserva a ese motor decidir quién causó salida.",
      total: 0,
      corteMadurez: null,
    };

    if (this.retencion) {
      const canonicas = await this.retencion.leerBajas({
        gymId: input.gymId,
        desde,
        hasta: hoy,
      });
      const sinMotivo = canonicas.membresiaIds.length === 0
        ? 0
        : await this.reader.contarBajasSinMotivo(
          input.gymId,
          canonicas.membresiaIds,
        );
      bajas = {
        evaluada: true,
        motivo: null,
        total: canonicas.total,
        corteMadurez: canonicas.corteMadurez,
      };
      controles.push(
        control({
          id: "bajas-sin-gestion",
          familia: "bajas",
          titulo: "Bajas que nadie gestionó",
          detalle:
            `${entero(canonicas.sinGestion)} de ${entero(canonicas.total)} ` +
            "salidas no tienen ninguna gestión de retención registrada. El " +
            "hueco mide el trabajo de retención tanto como los motivos, y no " +
            "se reparte entre los motivos conocidos (§7-ter).",
          afectados: canonicas.sinGestion,
          base: canonicas.total,
          destino: canonicas.sinGestion > 0 ? { tipo: "retencion" } : null,
        }),
        control({
          id: "bajas-no-localizadas",
          familia: "bajas",
          titulo: "Bajas no localizadas",
          detalle:
            `${entero(canonicas.noLocalizadas)} salidas terminaron en ` +
            "NO_LOCALIZADO. No es un dato perdido: dice que el socio se fue " +
            "sin que nadie pudiera hablarle, y de paso mide la calidad de los " +
            "teléfonos del padrón.",
          afectados: canonicas.noLocalizadas,
          base: canonicas.total,
          destino: canonicas.noLocalizadas > 0 ? { tipo: "retencion" } : null,
        }),
        control({
          id: "bajas-sin-motivo",
          familia: "bajas",
          titulo: "Bajas sin motivo codificado",
          detalle:
            `${entero(sinMotivo)} salidas gestionadas no llevan motivo del ` +
            "catálogo, solo nota libre o nada. Sin código no se pueden agrupar " +
            "en una gráfica de motivos.",
          afectados: sinMotivo,
          base: canonicas.total,
          destino: sinMotivo > 0 ? { tipo: "retencion" } : null,
        }),
      );
    }

    // Lo más grave arriba; a igual severidad, la peor cobertura; y a igual
    // cobertura, orden alfabético para que la lista no baile entre lecturas.
    const ordenados = [...controles].sort((a, b) =>
      PESO_SEVERIDAD[a.severidad] - PESO_SEVERIDAD[b.severidad] ||
      (a.coberturaPct ?? 101) - (b.coberturaPct ?? 101) ||
      a.titulo.localeCompare(b.titulo)
    );

    return {
      zona: input.zona,
      dia_negocio: hoy.toISOString().slice(0, 10),
      periodo: {
        dias: input.dias,
        desde: desde.toISOString().slice(0, 10),
        hasta: hoy.toISOString().slice(0, 10),
        // El padrón, las membresías, las asistencias y los cobros se revisan
        // enteros: un hueco de hace un año sigue estropeando la conclusión de
        // hoy. El período solo acota las bajas, que sí son un hecho fechado.
        aplicaA: "bajas",
      },
      controles: ordenados,
      resumen: {
        total: ordenados.length,
        peligro: ordenados.filter((c) => c.severidad === "peligro").length,
        aviso: ordenados.filter((c) => c.severidad === "aviso").length,
        ok: ordenados.filter((c) => c.severidad === "ok").length,
      },
      bases: {
        padron: socios.padron,
        membresias: membresias.total,
        asistencias: asistencias.total,
        cobros: cobros.total,
        bajas: bajas.total,
      },
      bajas,
      advertencias: [
        "La calidad no corrige nada: enseña el hueco y lleva al flujo donde se " +
        "resuelve.",
        "El recuento de bajas lo produce el motor canónico de retención; aquí " +
        "solo se mira cuáles tienen gestión y motivo (regla 11).",
        ...(bajas.evaluada ? [] : [bajas.motivo!]),
      ],
    };
  }
}
