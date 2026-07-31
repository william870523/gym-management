/**
 * Perfil estadístico del entrenador (docs/PLAN_ESTADISTICAS.md §4.1).
 *
 * Responde la pregunta que el dueño formuló primero: **cuántos socios ha ganado
 * y cuántos ha perdido**, y con qué cartera trabaja. La cifra que de verdad lo
 * juzga no es cuántos tiene, sino qué porcentaje de los suyos renovó.
 */
import type { EstadisticasEntrenadorReader } from "./estadisticas-entrenador.reader";
import { tasa, type Tasa } from "./estadisticas-socio.service";

export interface PerfilEntrenador {
  entrenador: {
    id: string;
    nombre: string;
    sexo: string;
    activo: boolean;
    antiguedadDias: number | null;
  };
  cartera: {
    activos: number;
    historicos: number;
    perdidos: number;
    /** Ganados y perdidos mes a mes. */
    movimientos: Array<{ mes: string; altas: number; bajas: number }>;
    motivosDeCierre: Array<{ motivo: string; total: number }>;
  };
  composicion: {
    porSexo: Array<{ etiqueta: string; total: number }>;
    porCategoria: Array<{ etiqueta: string; total: number }>;
    /** Preferencia declarada por los socios de la cartera vigente. */
    porFranjaDeclarada: Array<{ etiqueta: string; total: number }>;
    /** Visitas observadas durante una asignación con el entrenador. */
    porFranja: Array<{ etiqueta: string; total: number }>;
    porPlan: Array<{ etiqueta: string; total: number }>;
    porNacionalidad: Array<{ etiqueta: string; total: number }>;
    /** El plan que más atiende, o null si su cartera está vacía. */
    planLider: { etiqueta: string; total: number } | null;
  };
  constancia: {
    /** Los socios más constantes de su cartera activa. */
    masConstantes: Array<{ ci: string; nombre: string; visitas: number }>;
    visitasMediasPorSocio: number | null;
  };
  /** Qué porcentaje de los contratos de su cartera acabó en renovación. */
  retencion: Tasa;
  /** Ingreso atribuido, **por moneda**. Nunca sumado entre divisas. */
  ingresos: Array<{
    monedaId: string;
    cobros: number;
    total: number;
    ticketMedio: number;
  }>;
}

export class EstadisticasEntrenadorService {
  constructor(private readonly reader: EstadisticasEntrenadorReader) {}

  async perfil(input: {
    gymId: string;
    entrenadorId: string;
    zona: string;
    hoy: Date;
  }): Promise<PerfilEntrenador | null> {
    const entrenador = await this.reader.leerEntrenador(
      input.gymId,
      input.entrenadorId,
    );
    if (!entrenador) return null;

    const [
      cartera,
      movimientos,
      motivos,
      porSexo,
      porCategoria,
      porFranjaDeclarada,
      porFranjaObservada,
      porPlan,
      porNacionalidad,
      masConstantes,
      renovacion,
      ingresos,
    ] = await Promise.all([
      this.reader.leerCartera(input.gymId, input.entrenadorId),
      this.reader.leerMovimientos(input.gymId, input.entrenadorId, input.zona),
      this.reader.leerMotivosCierre(input.gymId, input.entrenadorId),
      this.reader.leerComposicion(input.gymId, input.entrenadorId, "sexo"),
      this.reader.leerComposicion(input.gymId, input.entrenadorId, "categoria"),
      this.reader.leerComposicion(input.gymId, input.entrenadorId, "horario"),
      this.reader.leerFranjasObservadas(
        input.gymId,
        input.entrenadorId,
        input.zona,
      ),
      this.reader.leerComposicion(input.gymId, input.entrenadorId, "plan"),
      this.reader.leerComposicion(
        input.gymId,
        input.entrenadorId,
        "nacionalidad",
      ),
      this.reader.leerSociosPorVisitas(input.gymId, input.entrenadorId, 5),
      this.reader.leerRenovacion(input.gymId, input.entrenadorId, input.hoy),
      this.reader.leerIngresos(input.gymId, input.entrenadorId),
    ]);

    const visitasTotales = masConstantes.reduce((s, x) => s + x.visitas, 0);

    return {
      entrenador: {
        id: entrenador.id,
        nombre: entrenador.nombre,
        sexo: entrenador.sexo,
        activo: entrenador.activo,
        antiguedadDias:
          entrenador.desde === null
            ? null
            : Math.max(
                0,
                Math.floor(
                  (input.hoy.getTime() - entrenador.desde.getTime()) /
                    86_400_000,
                ),
              ),
      },
      cartera: {
        activos: cartera.activos,
        historicos: cartera.historicos,
        perdidos: cartera.cerradas,
        movimientos,
        motivosDeCierre: motivos.map((m) => ({
          motivo: m.etiqueta,
          total: m.total,
        })),
      },
      composicion: {
        porSexo,
        porCategoria,
        porFranjaDeclarada,
        porFranja: porFranjaObservada,
        porPlan,
        porNacionalidad,
        planLider: porPlan[0] ?? null,
      },
      constancia: {
        masConstantes,
        // Media sobre los que se muestran, no sobre la cartera entera: decirlo
        // como «media de la cartera» sería exagerar con una muestra parcial.
        visitasMediasPorSocio:
          masConstantes.length === 0
            ? null
            : Math.round(visitasTotales / masConstantes.length),
      },
      retencion: tasa(
        renovacion.renovaciones,
        renovacion.terminadas,
      ),
      ingresos: ingresos.map((i) => ({
        monedaId: i.moneda_id,
        cobros: i.cobros,
        total: Math.round(i.total * 100) / 100,
        ticketMedio:
          i.cobros === 0 ? 0 : Math.round((i.total / i.cobros) * 100) / 100,
      })),
    };
  }
}

