import type {
  DireccionRanking,
  EstadisticasRankingsReader,
  OrdenRanking,
  RankingValorSocio,
  TipoRanking,
} from "./estadisticas-rankings.reader";
import {
  compararMetrica as comparar,
  TIPOS_RANKING,
} from "./estadisticas-rankings.reader";
import { calcularAlertas } from "./estadisticas-alertas";
import type {
  FilaRetencionCanonica,
  RetencionCanonicaReader,
} from "./estadisticas-segmentacion.reader";

const DIA_MS = 86_400_000;
const TAMANO_LOTE_EXPORTACION = 10_000;
const MAX_FILAS_EXPORTACION = 100_000;
export const PERIODOS_RANKINGS = [30, 90, 365] as const;
export type PeriodoRankings = (typeof PERIODOS_RANKINGS)[number];

const ORDENES_POR_TIPO: Record<TipoRanking, readonly OrdenRanking[]> = {
  planes: ["vendidos", "sociosConCobertura", "renovaciones", "nombre"],
  entrenadores: ["carteraActiva", "ganados", "perdidos", "nombre"],
  "socios-visitas": ["visitas", "diasSinVisita", "nombre"],
  "socios-inactividad": ["diasSinVisita", "visitas", "nombre"],
  "socios-cambios-entrenador": ["cambios", "nombre"],
  "socios-valor": ["total", "nombre"],
};

const ORDEN_PREDETERMINADO: Record<TipoRanking, OrdenRanking> = {
  planes: "vendidos",
  entrenadores: "carteraActiva",
  "socios-visitas": "visitas",
  "socios-inactividad": "diasSinVisita",
  "socios-cambios-entrenador": "cambios",
  "socios-valor": "total",
};

export class ConsultaRankingInvalida extends Error {}

function inicioUtc(fecha: Date) {
  return new Date(Date.UTC(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth(),
    fecha.getUTCDate(),
  ));
}

function diasEntre(desde: Date, hasta: Date) {
  return Math.max(0, Math.floor(
    (inicioUtc(hasta).getTime() - inicioUtc(desde).getTime()) / DIA_MS,
  ));
}

function limitar<T>(filas: T[], limite: number) {
  return filas.slice(0, limite);
}

function valorPorMoneda(filas: RankingValorSocio[], limite: number) {
  const grupos = new Map<string, RankingValorSocio[]>();
  for (const fila of filas) {
    const grupo = grupos.get(fila.monedaId) ?? [];
    grupo.push(fila);
    grupos.set(fila.monedaId, grupo);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monedaId, ranking]) => ({
      monedaId,
      ranking: ranking
        .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre))
        .slice(0, limite),
    }));
}

export class EstadisticasRankingsService {
  constructor(
    private readonly reader: EstadisticasRankingsReader,
    /**
     * Motor canónico de retención. Solo lo usa la alerta de churn por plan; sin
     * él esa regla se declara **no evaluada**, nunca en orden (regla 11).
     */
    private readonly retencion?: RetencionCanonicaReader,
  ) {}

  /**
   * El desglose canónico por plan, o `null` si no se pudo leer.
   *
   * Un fallo del motor no puede dejar la portada en blanco —es la pantalla de
   * entrada de administración—, pero tampoco puede pasar por «todo en orden»:
   * devolver `null` hace que la regla de churn viaje marcada como no evaluada.
   */
  private async desgloseCanonicoPorPlan(
    gymId: string,
    desde: Date,
    hasta: Date,
  ): Promise<FilaRetencionCanonica[] | null> {
    if (!this.retencion) return null;
    try {
      const desglose = await this.retencion.leerRetencion({
        gymId,
        desde,
        hasta,
      });
      return desglose.planes;
    } catch (error) {
      console.error(
        "No se pudo leer el motor canónico de retención para la alerta de " +
          "churn; la regla queda sin evaluar:",
        error,
      );
      return null;
    }
  }

  async portada(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    dias: PeriodoRankings;
    limite?: number;
  }) {
    const limite = Math.min(10, Math.max(3, input.limite ?? 5));
    const hoy = inicioUtc(input.hoy);
    const hastaExclusiva = new Date(hoy.getTime() + DIA_MS);
    const desde = new Date(hastaExclusiva.getTime() - input.dias * DIA_MS);
    const hastaAnteriorExclusiva = desde;
    const desdeAnterior = new Date(desde.getTime() - input.dias * DIA_MS);
    const hoyAnterior = new Date(desde.getTime() - DIA_MS);
    // Planes y entrenadores se leen completos, no recortados: la portada
    // enseña los cinco mayores, pero una alerta busca justo lo contrario —el
    // entrenador cuya cartera se hunde ya no está entre los cinco primeros—.
    // El recorte a Top 5 ocurre abajo, después de evaluar las reglas.
    const [
      resumen,
      indicadores,
      planes,
      entrenadores,
      porVisitasRaw,
      porInactividadRaw,
      cambiosEntrenador,
      valor,
    ] = await Promise.all([
      this.reader.leerResumen(input.gymId, hoy),
      this.reader.leerIndicadoresAlerta(
        input.gymId,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
      ),
      this.reader.leerPlanes(
        input.gymId,
        desde,
        hastaExclusiva,
        hoy,
        desdeAnterior,
        hastaAnteriorExclusiva,
        hoyAnterior,
        null,
      ),
      this.reader.leerEntrenadores(
        input.gymId,
        desde,
        hastaExclusiva,
        hoy,
        desdeAnterior,
        hastaAnteriorExclusiva,
        hoyAnterior,
        null,
      ),
      this.reader.leerSociosPorVisitas(
        input.gymId,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
        limite,
      ),
      this.reader.leerSociosPorInactividad(
        input.gymId,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
        limite,
      ),
      this.reader.leerCambiosEntrenador(
        input.gymId,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
        limite,
      ),
      this.reader.leerValorSocios(
        input.gymId,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
        limite,
      ),
    ]);

    const porVisitas = porVisitasRaw
      .sort((a, b) => b.visitas - a.visitas || a.nombre.localeCompare(b.nombre))
      .slice(0, limite)
      .map((fila) => ({
        ci: fila.ci,
        nombre: fila.nombre,
        visitas: fila.visitas,
        ultimaVisita: fila.ultimaVisita?.toISOString() ?? null,
        diasSinVisita: diasEntre(fila.ultimaVisita ?? fila.fechaInicio, hoy),
        comparacion: comparar("visitas", fila.visitas, fila.visitasAnterior),
      }));
    const porInactividad = porInactividadRaw
      .map((fila) => ({
        ...fila,
        diasSinVisita: diasEntre(fila.ultimaVisita ?? fila.fechaInicio, hoy),
        diasSinVisitaAnterior: diasEntre(
          fila.ultimaVisitaAnterior ?? fila.fechaInicio,
          hoyAnterior,
        ),
      }))
      .sort(
        (a, b) =>
          b.diasSinVisita - a.diasSinVisita ||
          a.visitas - b.visitas ||
          a.nombre.localeCompare(b.nombre),
      )
      .slice(0, limite)
      .map((fila) => ({
        ci: fila.ci,
        nombre: fila.nombre,
        visitas: fila.visitas,
        ultimaVisita: fila.ultimaVisita?.toISOString() ?? null,
        diasSinVisita: fila.diasSinVisita,
        comparacion: comparar(
          "diasSinVisita",
          fila.diasSinVisita,
          fila.diasSinVisitaAnterior,
        ),
      }));

    const alertas = calcularAlertas({
      resumen,
      indicadores,
      planes,
      entrenadores,
      retencionPlanes: await this.desgloseCanonicoPorPlan(
        input.gymId,
        desde,
        hoy,
      ),
    });

    return {
      zona: input.zona,
      dia_negocio: hoy.toISOString().slice(0, 10),
      periodo: {
        dias: input.dias,
        desde: desde.toISOString().slice(0, 10),
        hasta: hoy.toISOString().slice(0, 10),
      },
      periodoAnterior: {
        dias: input.dias,
        desde: desdeAnterior.toISOString().slice(0, 10),
        hasta: hoyAnterior.toISOString().slice(0, 10),
      },
      resumen,
      alertas: alertas.alertas,
      alertasOmitidas: alertas.omitidas,
      reglasAlerta: alertas.reglas,
      planes: planes
        .sort((a, b) => b.vendidos - a.vendidos || a.nombre.localeCompare(b.nombre))
        .slice(0, limite)
        .map((fila) => ({
          ...fila,
          comparacion: comparar(
            "vendidos",
            fila.vendidos,
            fila.vendidosAnterior,
          ),
        })),
      entrenadores: entrenadores
        .sort(
          (a, b) =>
            b.carteraActiva - a.carteraActiva ||
            b.ganados - a.ganados ||
            a.nombre.localeCompare(b.nombre),
        )
        .slice(0, limite)
        .map((fila) => ({
          ...fila,
          comparacion: comparar(
            "carteraActiva",
            fila.carteraActiva,
            fila.carteraActivaAnterior,
          ),
        })),
      socios: {
        porVisitas,
        porInactividad,
        porCambiosEntrenador: cambiosEntrenador
          .sort((a, b) => b.cambios - a.cambios || a.nombre.localeCompare(b.nombre))
          .slice(0, limite)
          .map((fila) => ({
            ...fila,
            comparacion: comparar(
              "cambios",
              fila.cambios,
              fila.cambiosAnterior,
            ),
          })),
        porValor: valorPorMoneda(
          valor.map((fila) => ({
            ...fila,
            comparacion: comparar("total", fila.total, fila.totalAnterior),
          })),
          limite,
        ),
      },
    };
  }

  async ranking(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    tipo: string;
    dias: number;
    pagina?: number;
    tamano?: number;
    busqueda?: string;
    orden?: string;
    direccion?: string;
    monedaId?: string;
    exportacion?: boolean;
  }) {
    if (!TIPOS_RANKING.includes(input.tipo as TipoRanking)) {
      throw new ConsultaRankingInvalida("El tipo de ranking no existe.");
    }
    if (!PERIODOS_RANKINGS.includes(input.dias as PeriodoRankings)) {
      throw new ConsultaRankingInvalida(
        "El período debe ser 30, 90 o 365 días.",
      );
    }

    const tipo = input.tipo as TipoRanking;
    const pagina = input.pagina ?? 1;
    const tamano = input.tamano ?? 25;
    if (!Number.isInteger(pagina) || pagina < 1) {
      throw new ConsultaRankingInvalida("La página debe ser un entero positivo.");
    }
    const tamanoMaximo = input.exportacion ? TAMANO_LOTE_EXPORTACION : 100;
    if (!Number.isInteger(tamano) || tamano < 1 || tamano > tamanoMaximo) {
      throw new ConsultaRankingInvalida(
        `El tamaño de página debe estar entre 1 y ${tamanoMaximo}.`,
      );
    }

    const busqueda = input.busqueda?.trim() ?? "";
    if (busqueda.length > 80) {
      throw new ConsultaRankingInvalida(
        "La búsqueda no puede superar 80 caracteres.",
      );
    }

    const orden = (input.orden?.trim() || ORDEN_PREDETERMINADO[tipo]) as
      OrdenRanking;
    if (!ORDENES_POR_TIPO[tipo].includes(orden)) {
      throw new ConsultaRankingInvalida(
        `El orden "${orden}" no está disponible para ${tipo}.`,
      );
    }
    const direccion = (input.direccion?.trim().toLowerCase() || "desc") as
      DireccionRanking;
    if (direccion !== "asc" && direccion !== "desc") {
      throw new ConsultaRankingInvalida(
        "La dirección debe ser asc o desc.",
      );
    }

    const monedaId = input.monedaId?.trim() || null;
    if (tipo === "socios-valor" && !monedaId) {
      throw new ConsultaRankingInvalida(
        "El ranking de valor requiere moneda_id.",
      );
    }
    if ((monedaId?.length ?? 0) > 100) {
      throw new ConsultaRankingInvalida(
        "La moneda no puede superar 100 caracteres.",
      );
    }

    const hoy = inicioUtc(input.hoy);
    const hastaExclusiva = new Date(hoy.getTime() + DIA_MS);
    const desde = new Date(
      hastaExclusiva.getTime() - input.dias * DIA_MS,
    );
    const hastaAnteriorExclusiva = desde;
    const desdeAnterior = new Date(desde.getTime() - input.dias * DIA_MS);
    const hoyAnterior = new Date(desde.getTime() - DIA_MS);
    const resultado = await this.reader.leerRanking({
      gymId: input.gymId,
      tipo,
      desde,
      hastaExclusiva,
      hoy,
      desdeAnterior,
      hastaAnteriorExclusiva,
      hoyAnterior,
      busqueda,
      orden,
      direccion,
      monedaId,
      limite: tamano,
      offset: (pagina - 1) * tamano,
    });
    const totalPaginas = resultado.total === 0
      ? 0
      : Math.ceil(resultado.total / tamano);
    const filas = resultado.filas.map((fila) => {
      if (
        tipo !== "socios-visitas" &&
        tipo !== "socios-inactividad"
      ) {
        if (tipo === "planes") {
          const plan = fila as {
            vendidos: number;
            vendidosAnterior: number;
          };
          return {
            ...fila,
            comparacion: comparar(
              "vendidos",
              plan.vendidos,
              plan.vendidosAnterior,
            ),
          };
        }
        if (tipo === "entrenadores") {
          const entrenador = fila as {
            carteraActiva: number;
            carteraActivaAnterior: number;
          };
          return {
            ...fila,
            comparacion: comparar(
              "carteraActiva",
              entrenador.carteraActiva,
              entrenador.carteraActivaAnterior,
            ),
          };
        }
        if (tipo === "socios-cambios-entrenador") {
          const cambios = fila as {
            cambios: number;
            cambiosAnterior: number;
          };
          return {
            ...fila,
            comparacion: comparar(
              "cambios",
              cambios.cambios,
              cambios.cambiosAnterior,
            ),
          };
        }
        const valor = fila as { total: number; totalAnterior: number };
        return {
          ...fila,
          comparacion: comparar("total", valor.total, valor.totalAnterior),
        };
      }
      const asistencia = fila as {
        ci: string;
        nombre: string;
        visitas: number;
        visitasAnterior: number;
        ultimaVisita: Date | null;
        ultimaVisitaAnterior: Date | null;
        fechaInicio: Date;
      };
      const diasSinVisita = diasEntre(
        asistencia.ultimaVisita ?? asistencia.fechaInicio,
        hoy,
      );
      const diasSinVisitaAnterior = diasEntre(
        asistencia.ultimaVisitaAnterior ?? asistencia.fechaInicio,
        hoyAnterior,
      );
      return {
        ci: asistencia.ci,
        nombre: asistencia.nombre,
        visitas: asistencia.visitas,
        ultimaVisita: asistencia.ultimaVisita?.toISOString() ?? null,
        diasSinVisita,
        comparacion: tipo === "socios-inactividad"
          ? comparar(
              "diasSinVisita",
              diasSinVisita,
              diasSinVisitaAnterior,
            )
          : comparar(
              "visitas",
              asistencia.visitas,
              asistencia.visitasAnterior,
            ),
      };
    });

    return {
      zona: input.zona,
      dia_negocio: hoy.toISOString().slice(0, 10),
      periodo: {
        dias: input.dias,
        desde: desde.toISOString().slice(0, 10),
        hasta: hoy.toISOString().slice(0, 10),
      },
      periodoAnterior: {
        dias: input.dias,
        desde: desdeAnterior.toISOString().slice(0, 10),
        hasta: hoyAnterior.toISOString().slice(0, 10),
      },
      tipo,
      busqueda,
      orden,
      direccion,
      monedaId,
      pagina: {
        numero: pagina,
        tamano,
        total: resultado.total,
        totalPaginas,
      },
      filas,
    };
  }

  async exportarCsv(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    tipo: string;
    dias: number;
    busqueda?: string;
    orden?: string;
    direccion?: string;
    monedaId?: string;
  }) {
    const primera = await this.ranking({
      ...input,
      pagina: 1,
      tamano: TAMANO_LOTE_EXPORTACION,
      exportacion: true,
    });
    if (primera.pagina.total > MAX_FILAS_EXPORTACION) {
      throw new ConsultaRankingInvalida(
        `La exportación supera el máximo de ${MAX_FILAS_EXPORTACION} filas.`,
      );
    }

    const filas = [...primera.filas];
    for (
      let pagina = 2;
      pagina <= primera.pagina.totalPaginas;
      pagina += 1
    ) {
      const lote = await this.ranking({
        ...input,
        pagina,
        tamano: TAMANO_LOTE_EXPORTACION,
        exportacion: true,
      });
      filas.push(...lote.filas);
    }

    const encabezados = [
      "tipo",
      "zona",
      "dia_negocio",
      "periodo_desde",
      "periodo_hasta",
      "periodo_anterior_desde",
      "periodo_anterior_hasta",
      "busqueda",
      "orden",
      "direccion",
      "moneda_id",
      "identificacion",
      "nombre",
      "metrica",
      "actual",
      "anterior",
      "delta",
      "variacion_porcentual",
      "vendidos",
      "socios_con_cobertura",
      "renovaciones",
      "cartera_activa",
      "ganados",
      "perdidos",
      "visitas",
      "dias_sin_visita",
      "ultima_visita",
      "cambios",
      "total",
    ];
    const valor = (fila: Record<string, unknown>, clave: string) =>
      fila[clave] == null ? "" : String(fila[clave]);
    const csvCell = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lineas = [
      encabezados.map(csvCell).join(","),
      ...filas.map((filaOriginal) => {
        const fila = filaOriginal as unknown as Record<string, unknown>;
        const comparacion = (fila.comparacion ?? {}) as Record<string, unknown>;
        return [
          primera.tipo,
          primera.zona,
          primera.dia_negocio,
          primera.periodo.desde,
          primera.periodo.hasta,
          primera.periodoAnterior.desde,
          primera.periodoAnterior.hasta,
          primera.busqueda,
          primera.orden,
          primera.direccion,
          primera.monedaId ?? "",
          valor(fila, "id") || valor(fila, "ci"),
          valor(fila, "nombre"),
          valor(comparacion, "metrica"),
          valor(comparacion, "actual"),
          valor(comparacion, "anterior"),
          valor(comparacion, "delta"),
          valor(comparacion, "variacionPorcentual"),
          valor(fila, "vendidos"),
          valor(fila, "sociosConCobertura"),
          valor(fila, "renovaciones"),
          valor(fila, "carteraActiva"),
          valor(fila, "ganados"),
          valor(fila, "perdidos"),
          valor(fila, "visitas"),
          valor(fila, "diasSinVisita"),
          valor(fila, "ultimaVisita"),
          valor(fila, "cambios"),
          valor(fila, "total"),
        ].map(csvCell).join(",");
      }),
    ];
    return {
      contenido: `\uFEFF${lineas.join("\r\n")}`,
      nombreArchivo:
        `estadisticas-${primera.tipo}-${primera.periodo.desde}-a-${primera.periodo.hasta}.csv`,
      total: filas.length,
    };
  }
}
