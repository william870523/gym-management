import { calendarioLocal } from "./calendario-estadisticas";

export interface IntervaloCartera {
  ci: string;
  desde: Date;
  /** null significa que la asignación sigue abierta. */
  hasta: Date | null;
}

export interface MovimientoCarteraMes {
  mes: string;
  altas: number;
  bajas: number;
}

/**
 * Une las asignaciones contiguas o solapadas de un socio antes de contar.
 *
 * Una renovación suele cerrar una asignación y abrir otra el mismo instante.
 * Sin esta unión aparecería como cliente perdido y ganado aunque nunca salió
 * de la cartera del entrenador.
 */
export function movimientosCarteraPorMes(
  intervalos: IntervaloCartera[],
  zona: string,
): MovimientoCarteraMes[] {
  const porSocio = new Map<string, IntervaloCartera[]>();
  for (const intervalo of intervalos) {
    const lista = porSocio.get(intervalo.ci) ?? [];
    lista.push(intervalo);
    porSocio.set(intervalo.ci, lista);
  }

  const movimientos = new Map<string, MovimientoCarteraMes>();
  const sumar = (fecha: Date, campo: "altas" | "bajas") => {
    const mes = calendarioLocal(fecha, zona).mes;
    const fila = movimientos.get(mes) ?? { mes, altas: 0, bajas: 0 };
    fila[campo] += 1;
    movimientos.set(mes, fila);
  };

  for (const lista of porSocio.values()) {
    const ordenados = [...lista].sort(
      (a, b) => a.desde.getTime() - b.desde.getTime(),
    );
    let actual: IntervaloCartera | null = null;

    for (const siguiente of ordenados) {
      if (!actual) {
        actual = { ...siguiente };
        continue;
      }

      const seTocan =
        actual.hasta === null ||
        siguiente.desde.getTime() <= actual.hasta.getTime();
      if (seTocan) {
        actual.hasta =
          actual.hasta === null || siguiente.hasta === null
            ? null
            : new Date(
                Math.max(actual.hasta.getTime(), siguiente.hasta.getTime()),
              );
        continue;
      }

      sumar(actual.desde, "altas");
      if (actual.hasta) sumar(actual.hasta, "bajas");
      actual = { ...siguiente };
    }

    if (actual) {
      sumar(actual.desde, "altas");
      if (actual.hasta) sumar(actual.hasta, "bajas");
    }
  }

  return [...movimientos.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

