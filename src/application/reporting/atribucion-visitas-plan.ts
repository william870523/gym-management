import {
  calendarioLocal,
  diaCanonico,
} from "./calendario-estadisticas";
import { franjaDe } from "./estadisticas-socio.service";

export interface CoberturaPlan {
  ci: string;
  desde: Date;
  hasta: Date;
}

export interface VisitaCandidataPlan {
  id: string;
  ci: string;
  instante: Date;
}

export interface UsoAtribuidoPlan {
  visitas: number;
  socios: number;
  porFranja: Array<{ etiqueta: string; total: number }>;
}

/**
 * Atribuye visitas a coberturas de plan usando calendario de negocio.
 *
 * Las fechas de membresía son días canónicos; los accesos son instantes UTC.
 * Por eso la comparación correcta es entre el día local del acceso y el
 * intervalo contractual [desde, hasta), no entre epochs crudos.
 */
export function atribuirVisitasAPlan(
  coberturas: CoberturaPlan[],
  visitas: VisitaCandidataPlan[],
  zona: string,
): UsoAtribuidoPlan {
  const porSocio = new Map<string, Array<{ desde: string; hasta: string }>>();
  for (const cobertura of coberturas) {
    const lista = porSocio.get(cobertura.ci) ?? [];
    lista.push({
      desde: diaCanonico(cobertura.desde),
      hasta: diaCanonico(cobertura.hasta),
    });
    porSocio.set(cobertura.ci, lista);
  }

  const atribuidas = new Set<string>();
  const franjas = new Map<string, number>();
  for (const visita of visitas) {
    const local = calendarioLocal(visita.instante, zona);
    const cubierta = (porSocio.get(visita.ci) ?? []).some(
      (cobertura) =>
        local.dia >= cobertura.desde && local.dia < cobertura.hasta,
    );
    if (!cubierta || atribuidas.has(visita.id)) continue;

    atribuidas.add(visita.id);
    const franja = franjaDe(local.hora);
    franjas.set(franja, (franjas.get(franja) ?? 0) + 1);
  }

  return {
    visitas: atribuidas.size,
    socios: porSocio.size,
    porFranja: [...franjas.entries()]
      .map(([etiqueta, total]) => ({ etiqueta, total }))
      .sort((a, b) => b.total - a.total),
  };
}

