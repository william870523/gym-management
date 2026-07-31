/**
 * Perfil estadístico de un plan (docs/PLAN_ESTADISTICAS.md §4.2).
 *
 * Responde si el producto funciona: quién lo contrata, si lo renuevan, cuánto
 * deja, si se usa de verdad y —el gráfico que más dice— **a qué plan se van los
 * que lo dejan y de cuál vienen los que llegan**. Un plan puede parecer sano y
 * estar canibalizando a otro.
 */
import type { EstadisticasPlanReader } from "./estadisticas-plan.reader";
import { tasa, type Tasa } from "./estadisticas-socio.service";

export interface PerfilPlan {
  plan: {
    id: string;
    nombre: string;
    codigo: string | null;
    importe: number;
    monedaId: string;
    duracionDias: number;
    activo: boolean;
    incluyeEntrenador: boolean;
    aceptaCuotas: boolean;
  };
  contratacion: {
    socios: number;
    vigentes: number;
    pendientes: number;
    pausadas: number;
    terminadas: number;
    porMes: Array<{ etiqueta: string; total: number }>;
    tasaRenovacion: Tasa;
  };
  composicion: {
    porSexo: Array<{ etiqueta: string; total: number }>;
    porCategoria: Array<{ etiqueta: string; total: number }>;
    /** Preferencia declarada en la ficha del socio. */
    porFranjaDeclarada: Array<{ etiqueta: string; total: number }>;
    /** Franja observada en visitas atribuibles a la cobertura del plan. */
    porFranja: Array<{ etiqueta: string; total: number }>;
    porEntrenador: Array<{ etiqueta: string; total: number }>;
  };
  movilidad: {
    vienenDe: Array<{ etiqueta: string; total: number }>;
    seVanA: Array<{ etiqueta: string; total: number }>;
    /** Saldo neto de cambios: positivo si gana socios de otros planes. */
    saldo: number;
  };
  dinero: Array<{
    monedaId: string;
    cobros: number;
    total: number;
    ticketMedio: number;
    descuentoTotal: number;
    recargoTotal: number;
  }>;
  duracion: {
    contratadaDias: number;
    realMediaDias: number | null;
    /** Días que la cobertura se estira de media, por pausas. */
    desviacionDias: number | null;
  };
  uso: {
    visitas: number;
    sociosConCobertura: number;
    /** Visitas atribuibles por socio que ha tenido cobertura del plan. */
    visitasPorSocio: number | null;
  };
  cuotas: {
    membresiasFraccionadas: number;
    cuotasEmitidas: number;
  };
}

export class EstadisticasPlanService {
  constructor(private readonly reader: EstadisticasPlanReader) {}

  async perfil(input: {
    gymId: string;
    planId: string;
    zona: string;
    hoy: Date;
  }): Promise<PerfilPlan | null> {
    const plan = await this.reader.leerPlan(input.gymId, input.planId);
    if (!plan) return null;

    const [
      estados,
      porMes,
      porSexo,
      porCategoria,
      porFranjaDeclarada,
      porEntrenador,
      vienenDe,
      seVanA,
      renovacion,
      ingresos,
      duracion,
      uso,
      cuotas,
    ] = await Promise.all([
      this.reader.leerEstados(input.gymId, input.planId, input.hoy),
      this.reader.leerContratacionesPorMes(
        input.gymId,
        input.planId,
        input.zona,
      ),
      this.reader.leerComposicion(input.gymId, input.planId, "sexo", input.hoy),
      this.reader.leerComposicion(
        input.gymId,
        input.planId,
        "categoria",
        input.hoy,
      ),
      this.reader.leerComposicion(
        input.gymId,
        input.planId,
        "horario",
        input.hoy,
      ),
      this.reader.leerComposicion(
        input.gymId,
        input.planId,
        "entrenador",
        input.hoy,
      ),
      this.reader.leerVienenDe(input.gymId, input.planId),
      this.reader.leerSeVanA(input.gymId, input.planId),
      this.reader.leerRenovacion(input.gymId, input.planId, input.hoy),
      this.reader.leerIngresos(input.gymId, input.planId),
      this.reader.leerDuracion(input.gymId, input.planId),
      this.reader.leerUso(
        input.gymId,
        input.planId,
        input.zona,
        input.hoy,
      ),
      this.reader.leerCuotas(input.gymId, input.planId),
    ]);

    const entran = vienenDe.reduce((s, x) => s + x.total, 0);
    const salen = seVanA.reduce((s, x) => s + x.total, 0);

    return {
      plan: {
        id: plan.id,
        nombre: plan.nombre,
        codigo: plan.codigo,
        importe: plan.importe,
        monedaId: plan.monedaId,
        duracionDias: plan.duracionDias,
        activo: plan.activo,
        incluyeEntrenador: plan.incluyeEntrenador,
        aceptaCuotas: plan.aceptaCuotas,
      },
      contratacion: {
        socios: estados.socios,
        vigentes: estados.vigentes,
        pendientes: estados.pendientes,
        pausadas: estados.pausadas,
        terminadas: estados.terminadas,
        porMes,
        tasaRenovacion: tasa(
          renovacion.renovaciones,
          renovacion.terminadas,
        ),
      },
      composicion: {
        porSexo,
        porCategoria,
        porFranjaDeclarada,
        porFranja: uso.porFranja,
        porEntrenador,
      },
      movilidad: { vienenDe, seVanA, saldo: entran - salen },
      dinero: ingresos.map((i) => ({
        monedaId: i.moneda_id,
        cobros: i.cobros,
        total: Math.round(i.total * 100) / 100,
        ticketMedio:
          i.cobros === 0 ? 0 : Math.round((i.total / i.cobros) * 100) / 100,
        descuentoTotal: Math.round(i.descuentoTotal * 100) / 100,
        recargoTotal: Math.round(i.recargoTotal * 100) / 100,
      })),
      duracion: {
        contratadaDias: duracion.contratada,
        realMediaDias: duracion.realMedia,
        desviacionDias:
          duracion.realMedia === null
            ? null
            : Math.round((duracion.realMedia - duracion.contratada) * 10) / 10,
      },
      uso: {
        visitas: uso.visitas,
        sociosConCobertura: uso.socios,
        visitasPorSocio:
          uso.socios === 0 ? null : Math.round((uso.visitas / uso.socios) * 10) / 10,
      },
      cuotas: {
        membresiasFraccionadas: cuotas.membresiasConCuotas,
        cuotasEmitidas: cuotas.cuotas,
      },
    };
  }
}

