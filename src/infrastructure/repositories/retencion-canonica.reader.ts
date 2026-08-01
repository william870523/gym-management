import type {
  FilaRetencionCanonica,
  RetencionCanonicaReader,
} from "../../application/reporting/estadisticas-segmentacion.reader";
import { RetentionService } from "../../application/retention/retention.service";

/**
 * Lee el motor canónico de retención para el cruzador.
 *
 * Esto **no clasifica nada**. Le pregunta a `RetentionService`, que es el mismo
 * que alimenta la pantalla de Control y Calidad, y traduce su desglose a filas.
 * Es la forma de cumplir la regla 11 del plan: la estadística consume la
 * retención, no la recalcula.
 *
 * Si un día el cruzador y Control y Calidad dieran cifras distintas, el defecto
 * estaría en esta traducción de diez líneas —no en dos fórmulas rivales—,
 * porque fórmula solo hay una.
 */
export class RetencionCanonicaDesdeServicio implements RetencionCanonicaReader {
  constructor(private readonly servicio = new RetentionService()) {}

  async leerRetencion(input: {
    gymId: string;
    desde: Date;
    hasta: Date;
  }): Promise<{
    planes: FilaRetencionCanonica[];
    entrenadores: FilaRetencionCanonica[];
  }> {
    const panel = await this.servicio.getDashboard(input.gymId, {
      from: input.desde.toISOString().slice(0, 10),
      to: input.hasta.toISOString().slice(0, 10),
    });
    const desglose = (panel as any)?.breakdowns ?? {};
    return {
      planes: traducir(desglose.plans),
      entrenadores: traducir(desglose.trainers),
    };
  }
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
