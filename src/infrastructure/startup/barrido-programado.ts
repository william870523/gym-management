/**
 * Dispara el barrido de copias de visitante caducadas (M4a, §9-bis).
 *
 * ## Por qué existe
 *
 * El barrido estaba escrito, probado y **no lo ejecutaba nadie**: había que
 * acordarse de lanzar `bun run barrer:visitantes --aplicar` a mano. Un
 * mantenimiento que depende de que alguien se acuerde no es un mantenimiento;
 * es una deuda con fecha de vencimiento desconocida. Las copias muertas se
 * acumulan en **todas** las sedes, porque cada una descarga la suya, y el
 * listado de visitantes acaba enseñando gente que hace meses que no viene.
 *
 * Conviene decir qué **no** arregla, para que nadie se confíe: la puerta no
 * depende de esto. `decidirVisita` comprueba el plus contra el día de negocio y
 * `decidirEntradaVisitante` comprueba la cobertura de la membresía de origen, y
 * las dos bloquean por su cuenta aunque la copia siga ahí. Esto es higiene del
 * dato, no el control de acceso.
 *
 * ## Una sola instancia barre
 *
 * Es la lección del 31-07-2026, cuando tres APIs locales huérfanas escribían
 * sobre la misma base. Dos concentradores barriendo a la vez emitirían la baja
 * de la misma copia dos veces. `registrarInstancia` ya devuelve las otras
 * instancias vivas del mismo servicio: si hay alguna, este proceso **no**
 * programa nada y lo dice.
 *
 * ## Qué deja
 *
 * Lo que retira ya queda en `sync_log` —un `DELETE` por copia, global— y lo que
 * **pone al día** deja un `UPDATE` por copia, así que el rastro de qué se fue y
 * de qué cambió es durable y consultable. Lo que faltaba era saber
 * si el barrido **llegó a correr**, que es distinto de que no encontrara nada.
 * Eso se publica en `/health`.
 */
import { logger } from "../../config/logger";
import { barrerVisitantesCaducados } from "../../application/acceso-multisede/barrido-visitantes";

export interface EstadoDelBarrido {
  /** `false` cuando no se programó: otra instancia manda, o está apagado. */
  readonly programado: boolean;
  readonly motivo?: string;
  readonly intervaloHoras?: number;
  readonly ultimaEjecucion?: {
    readonly at: string;
    readonly revisadas: number;
    readonly retiradas: number;
    /** Copias conservadas cuya membresía de origen se puso al día. */
    readonly refrescadas: number;
    readonly ok: boolean;
    readonly error?: string;
  };
}

let estado: EstadoDelBarrido = {
  programado: false,
  motivo: "todavía no se ha arrancado",
};

/** Lo que `/health` publica. Sin esto, «no encontró nada» y «no corrió» se leen igual. */
export const estadoDelBarrido = (): EstadoDelBarrido => estado;

/** Ejecuta una pasada y deja constancia. Nunca lanza: un fallo no tumba la API. */
export async function ejecutarBarridoUnaVez(): Promise<void> {
  try {
    const r = await barrerVisitantesCaducados({ aplicar: true });
    estado = {
      ...estado,
      ultimaEjecucion: {
        at: new Date().toISOString(),
        revisadas: r.revisadas,
        retiradas: r.retiradas.length,
        refrescadas: r.refrescadas.length,
        ok: true,
      },
    };
    // Se registra también cuando no retira nada: es la prueba de que corrió.
    logger.info("Barrido de copias de visitante ejecutado", {
      revisadas: r.revisadas,
      retiradas: r.retiradas.length,
      refrescadas: r.refrescadas.length,
      ci: r.retiradas,
      alDia: r.refrescadas,
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    estado = {
      ...estado,
      ultimaEjecucion: {
        at: new Date().toISOString(),
        revisadas: 0,
        retiradas: 0,
        refrescadas: 0,
        ok: false,
        error: mensaje,
      },
    };
    // No se relanza: que el barrido falle no puede tumbar el concentrador, y
    // el fallo queda visible en `/health` y en el registro.
    logger.error("El barrido de copias de visitante falló", { error: mensaje });
  }
}

/**
 * Programa el barrido, si a este proceso le toca.
 *
 * `retrasoInicialMs` existe para no barrer en el mismo instante del arranque:
 * el concentrador acaba de calibrar el reloj y de esperar a la base, y meterle
 * una transacción larga encima retrasa las primeras peticiones reales.
 */
export function programarBarridoDeVisitantes(opciones: {
  readonly otrasInstancias: number;
  readonly intervaloHoras: number;
  readonly habilitado: boolean;
  readonly retrasoInicialMs?: number;
}): EstadoDelBarrido {
  if (!opciones.habilitado) {
    estado = { programado: false, motivo: "apagado por configuración" };
    logger.info("Barrido de copias de visitante apagado por configuración");
    return estado;
  }
  if (opciones.otrasInstancias > 0) {
    // No es un error: es el reparto correcto. Quien arrancó primero barre.
    estado = {
      programado: false,
      motivo: `hay ${opciones.otrasInstancias} instancia(s) del concentrador ya viva(s); barre la primera`,
    };
    logger.warn("Barrido no programado: otra instancia del concentrador manda", {
      otras: opciones.otrasInstancias,
    });
    return estado;
  }

  const intervaloMs = Math.max(1, opciones.intervaloHoras) * 60 * 60 * 1000;
  estado = { programado: true, intervaloHoras: opciones.intervaloHoras };

  const primera = setTimeout(
    () => void ejecutarBarridoUnaVez(),
    opciones.retrasoInicialMs ?? 30_000,
  );
  const cada = setInterval(() => void ejecutarBarridoUnaVez(), intervaloMs);
  // Que no impidan cerrar el proceso: son mantenimiento, no trabajo pendiente.
  primera.unref?.();
  cada.unref?.();

  logger.info("Barrido de copias de visitante programado", {
    cadaHoras: opciones.intervaloHoras,
  });
  return estado;
}
