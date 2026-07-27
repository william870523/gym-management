/**
 * Vigencia de una membresía: si **hoy** cubre o ya no
 * (docs/DEMO_MEMBERSHIP_VIGENCIA.md).
 *
 * El problema que resuelve: `membresia_cliente.estado` admite `VENCIDA`, pero
 * **nadie lo escribe nunca**. El estado se pone `ACTIVA` al activar y ahí se
 * queda; una membresía cuya cobertura terminó hace una semana sigue diciendo
 * `ACTIVA`. Eso convierte «vigente» en una palabra que cada consumidor
 * interpretaba por su cuenta.
 *
 * **Se deriva, no se persiste, y es a propósito.** El estado guardado registra
 * *actos* —se activó, se pausó, se canceló—; la cobertura es una *función de
 * fechas*. Un trabajo programado que reescribiera `ACTIVA → VENCIDA` añadiría
 * un cambio de estado que nadie hizo, generaría eventos de sincronización y
 * volvería a mentir el día que no corriera. Una función pura contra la fecha de
 * negocio no puede quedarse obsoleta.
 *
 * **La fecha que manda es la de negocio del gimnasio**, no el día UTC ni el del
 * dispositivo (docs/TIME_CONTRACT.md). Anclar al día UTC hace que la cobertura
 * caduque a medianoche de Londres para un gimnasio de Los Ángeles.
 *
 * **Esta función es gemela de la de `gym-local-api`. Si cambia una, cambia la
 * otra**, o el escritorio y la web dirán cosas distintas del mismo socio.
 */

/** Vigencia derivada. No se guarda en la base: se calcula al leer. */
export type MembershipVigencia =
  /** Contratada y sin pagar: no cubre todavía, pero el socio existe. */
  | "PENDIENTE_PAGO"
  /** Congelada por acuerdo: no consume días y no vence mientras dure. */
  | "PAUSADA"
  /** Cubre hoy. */
  | "VIGENTE"
  /** La cobertura terminó, pero dentro de la ventana de cortesía. */
  | "VENCIDA_RECIENTE"
  /** La cobertura terminó y ya pasó la ventana. */
  | "VENCIDA"
  /** Dada de baja. Deja de contar aunque su fecha aún cubriera. */
  | "CANCELADA"
  /** Sin membresía, o con un estado que no reconocemos. */
  | "SIN_MEMBRESIA";

/**
 * Días naturales que una membresía vencida sigue contando como reciente.
 *
 * Es el mismo número que usa el cliente Flutter para los asociados de un plan
 * (docs/PLAN_ASOCIADOS.md §5, decisión del dueño del 25-07-2026). Moverlo aquí
 * mueve las dos cosas a la vez, que es justo lo que se quiere: si el contador
 * de un plan dice 11 y la ficha del socio dice «vencida», el operador deja de
 * creerse los dos.
 */
export const DIAS_VENCIMIENTO_RECIENTE = 30;

const DAY_MS = 86_400_000;

/** Día de calendario UTC de un instante, sin hora. */
function calendarDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export interface MembershipVigenciaInput {
  /** Estado persistido: el acto, no la cobertura. */
  estado: string | null | undefined;
  /** Fin de cobertura. Inclusivo: el último día cubierto todavía cubre. */
  fechaFin: Date | string | null | undefined;
  /** Fecha de negocio del gimnasio, no la del dispositivo. */
  fechaNegocio: Date;
}

export interface MembershipVigenciaResult {
  vigencia: MembershipVigencia;
  /**
   * Días desde que terminó la cobertura. Negativo si aún cubre —y entonces es
   * «cuántos días quedan», que es lo que necesita un aviso de «por vencer»—.
   * `null` cuando la fecha no aplica o no se conoce.
   */
  diasDesdeVencimiento: number | null;
  /** `true` solo si la membresía cubre hoy. Ni pausada ni vencida cubren. */
  cubreHoy: boolean;
}

/**
 * Deriva la vigencia de una membresía.
 *
 * El orden de las comprobaciones no es casual:
 *
 * 1. `CANCELADA` manda sobre la fecha: quien se dio de baja no está vigente
 *    aunque su plan cubriera hasta fin de mes.
 * 2. `PAUSADA` manda sobre la fecha porque una pausa **detiene el reloj**; su
 *    `fecha_fin` se recalcula al reanudar (`membership-pause.service.ts`), así
 *    que compararla contra hoy mientras dura la pausa no significa nada.
 * 3. `PENDIENTE_PAGO` no cubre: se contrató y no se pagó.
 * 4. Solo entonces manda la cobertura.
 */
export function resolveMembershipVigencia(
  input: MembershipVigenciaInput,
): MembershipVigenciaResult {
  const estado = (input.estado ?? "").trim().toUpperCase();
  if (!estado) {
    return { vigencia: "SIN_MEMBRESIA", diasDesdeVencimiento: null, cubreHoy: false };
  }
  if (estado === "CANCELADA") {
    return { vigencia: "CANCELADA", diasDesdeVencimiento: null, cubreHoy: false };
  }
  if (estado === "PAUSADA") {
    return { vigencia: "PAUSADA", diasDesdeVencimiento: null, cubreHoy: false };
  }
  if (estado === "PENDIENTE_PAGO" || estado === "PENDIENTE") {
    return { vigencia: "PENDIENTE_PAGO", diasDesdeVencimiento: null, cubreHoy: false };
  }
  if (estado !== "ACTIVA" && estado !== "VENCIDA") {
    // Un estado que no reconocemos no se interpreta como vigente: fallar
    // cerrado es lo correcto cuando lo que está en juego es quién entra.
    return { vigencia: "SIN_MEMBRESIA", diasDesdeVencimiento: null, cubreHoy: false };
  }

  const fin = input.fechaFin == null ? null : new Date(input.fechaFin);
  if (!fin || Number.isNaN(fin.getTime())) {
    // Activa sin fecha de fin: no hay con qué decidir que venció.
    return { vigencia: "VIGENTE", diasDesdeVencimiento: null, cubreHoy: true };
  }

  const hoy = calendarDay(input.fechaNegocio);
  const dias = Math.round((hoy.getTime() - calendarDay(fin).getTime()) / DAY_MS);

  // El último día de cobertura todavía cubre: `dias <= 0`.
  if (dias <= 0) {
    return { vigencia: "VIGENTE", diasDesdeVencimiento: dias, cubreHoy: true };
  }
  return {
    vigencia: dias <= DIAS_VENCIMIENTO_RECIENTE ? "VENCIDA_RECIENTE" : "VENCIDA",
    diasDesdeVencimiento: dias,
    cubreHoy: false,
  };
}

/** Fecha de negocio del gimnasio a partir de las partes de su zona horaria. */
export function fechaNegocioDesdePartes(parts: {
  year: number;
  month: number;
  day: number;
}): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}
