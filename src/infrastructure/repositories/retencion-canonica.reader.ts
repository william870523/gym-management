import type {
  FilaRetencionCanonica,
  RetencionCanonicaReader,
} from "../../application/reporting/estadisticas-segmentacion.reader";
import type {
  HistoriaCanonica,
  HistoriaCanonicaSocio,
  RetencionHistoriaReader,
} from "../../application/reporting/estadisticas-cohortes.reader";
import type {
  BajasCanonicas,
  RetencionBajasReader,
} from "../../application/reporting/estadisticas-calidad.reader";
import { RetentionService } from "../../application/retention/retention.service";

/**
 * Lee el motor canónico de retención para la estadística.
 *
 * Esto **no clasifica nada**. Le pregunta a `RetentionService`, que es el mismo
 * que alimenta la pantalla de Control y Calidad, y traduce su desglose. Es la
 * forma de cumplir la regla 11 del plan: la estadística consume la retención,
 * no la recalcula.
 *
 * Si un día el cruzador y Control y Calidad dieran cifras distintas, el defecto
 * estaría en estas traducciones —cortas y a la vista—, no en dos fórmulas
 * rivales, porque fórmula solo hay una.
 *
 * Las tres superficies que lo usan piden tres cosas distintas al mismo panel:
 * el **cruzador** su desglose por plan y entrenador, las **cohortes de alta** la
 * fecha en que cada socio salió o renovó, y la **calidad de datos** qué
 * oportunidades causaron salida para mirarles la gestión.
 */
export class RetencionCanonicaDesdeServicio
  implements RetencionCanonicaReader, RetencionHistoriaReader, RetencionBajasReader
{
  constructor(private readonly servicio = new RetentionService()) {}

  private panel(input: { gymId: string; desde: Date; hasta: Date }) {
    return this.servicio.getDashboard(input.gymId, {
      from: input.desde.toISOString().slice(0, 10),
      to: input.hasta.toISOString().slice(0, 10),
    });
  }

  async leerRetencion(input: {
    gymId: string;
    desde: Date;
    hasta: Date;
  }): Promise<{
    planes: FilaRetencionCanonica[];
    entrenadores: FilaRetencionCanonica[];
  }> {
    const panel = await this.panel(input);
    const desglose = (panel as any)?.breakdowns ?? {};
    return {
      planes: traducir(desglose.plans),
      entrenadores: traducir(desglose.trainers),
    };
  }

  /**
   * Historia por socio: cuándo salió y cuándo renovó por primera vez.
   *
   * Las dos fechas salen tal cual del motor. `exit_date` es el primer día en que
   * el socio dejó de serlo —ya descontada la gracia— y solo se toma de las
   * oportunidades que el motor marcó como salida histórica. Una renovación
   * cuenta cuando el motor le reconoció evidencia; si no la tiene, no la
   * inventamos aquí.
   */
  async leerHistoria(input: {
    gymId: string;
    desde: Date;
    hasta: Date;
  }): Promise<HistoriaCanonica> {
    const panel: any = await this.panel(input);
    const items: any[] = Array.isArray(panel?.items) ? panel.items : [];

    const porSocio = new Map<string, HistoriaCanonicaSocio>();
    for (const item of items) {
      const ci = String(item?.ci ?? "");
      if (!ci) continue;
      const fila = porSocio.get(ci)
        ?? { ci, diaPrimeraSalida: null, diaPrimeraRenovacion: null };

      if (item?.historical_exit === true && typeof item?.exit_date === "string") {
        fila.diaPrimeraSalida = menor(fila.diaPrimeraSalida, item.exit_date);
      }
      const renovacion = item?.renewal?.effective_date;
      if (typeof renovacion === "string") {
        fila.diaPrimeraRenovacion = menor(fila.diaPrimeraRenovacion, renovacion);
      }
      porSocio.set(ci, fila);
    }

    return {
      socios: [...porSocio.values()],
      corteMadurez: String(panel?.policy?.mature_cohort_cutoff ?? ""),
      diasGracia: Number(panel?.policy?.grace_days ?? 0),
      advertencias: advertenciasDe(panel),
    };
  }

  /**
   * Qué oportunidades causaron salida, para que la calidad de datos les mire la
   * gestión. Quién es baja lo decide el motor; aquí solo se recogen sus ids.
   */
  async leerBajas(input: {
    gymId: string;
    desde: Date;
    hasta: Date;
  }): Promise<BajasCanonicas> {
    const panel: any = await this.panel(input);
    const items: any[] = Array.isArray(panel?.items) ? panel.items : [];
    const bajas = items.filter((item) => item?.historical_exit === true);

    return {
      membresiaIds: bajas
        .map((item) => String(item?.membership_id ?? ""))
        .filter((id) => id.length > 0),
      total: bajas.length,
      sinGestion: bajas.filter(
        (item) => (item?.management?.status ?? "PENDIENTE") === "PENDIENTE",
      ).length,
      noLocalizadas: bajas.filter(
        (item) => item?.management?.status === "NO_LOCALIZADO",
      ).length,
      corteMadurez: String(panel?.policy?.mature_cohort_cutoff ?? ""),
    };
  }
}

/** Tope de oportunidades que el motor lee de una vez. */
const TOPE_ITEMS_MOTOR = 2000;

function advertenciasDe(panel: any): string[] {
  const caveats: string[] = Array.isArray(panel?.quality?.caveats)
    ? panel.quality.caveats.map((texto: unknown) => String(texto))
    : [];
  const visibles = Number(panel?.metrics?.total_visible ?? 0);
  // El motor lee un máximo de oportunidades por consulta. Rozar ese tope
  // significa que la ventana consultada es más larga que lo que cabe, y una
  // cohorte construida sobre una historia recortada no debe leerse como total.
  if (visibles >= TOPE_ITEMS_MOTOR) {
    caveats.push(
      `El motor de retención devolvió ${visibles} oportunidades, su tope por ` +
        "consulta: la historia leída puede estar recortada y las cohortes más " +
        "antiguas incompletas.",
    );
  }
  return caveats;
}

function menor(actual: string | null, candidato: string): string {
  return actual === null || candidato < actual ? candidato : actual;
}

/**
 * `mature_eligible` es el denominador que manda la regla 11: oportunidades cuya
 * gracia ya terminó. Las que siguen abiertas quedan fuera a propósito —todavía
 * pueden renovar— y por eso no se usa `total_due`.
 */
function traducir(filas: unknown): FilaRetencionCanonica[] {
  if (!Array.isArray(filas)) return [];
  return filas.map((fila: any) => ({
    id: String(fila?.id ?? ""),
    nombre: String(fila?.name ?? fila?.id ?? ""),
    maduras: Number(fila?.mature_eligible ?? 0),
    retenidas: Number(fila?.retained ?? 0),
    bajas: Number(fila?.historical_exits ?? 0),
  }));
}
