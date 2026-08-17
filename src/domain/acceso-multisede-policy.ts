/**
 * Acceso multi-sede: el «plus» que deja entrenar en cualquier sede de la cadena
 * (docs/MULTI_SEDE.md §5, §9-bis y las respuestas del dueño del 25-07-2026).
 *
 * Lo que decide este módulo es **quién es visitante y si puede serlo**, que es
 * una pregunta distinta de «esta membresía cubre hoy». Conviene tenerlas
 * separadas porque un visitante bloqueado y un socio con la cuota vencida se
 * arreglan de maneras opuestas: al primero se le cobra el plus, al segundo su
 * plan. Mezclarlas produce el mensaje inútil de «no puede entrar» sin decir por
 * cuál de las dos cosas.
 *
 * **El plus no es un atributo del plan, es una segunda suscripción.** Tiene su
 * propio ciclo —mensual, aunque el plan sea trimestral—, su propio precio
 * —global de la cadena— y su propio vencimiento. De ahí que un socio pueda
 * estar al día con su plan y sin acceso a otras sedes, o al revés. La entrada a
 * la sede **propia** nunca depende de este módulo: quien pagó su plan entra en
 * su gimnasio aunque no haya pagado el plus jamás.
 *
 * **`vigente_hasta` es EXCLUSIVA**, igual que `membresia_cliente.fecha_fin`
 * (ver `membership-vigencia.ts`). No es capricho: dos convenciones distintas de
 * «hasta» en el mismo producto es un día regalado o un día robado, y el error
 * aparece una vez al mes en el sitio donde nadie mira.
 *
 * **La fecha que manda es la de negocio del gimnasio**, no el día UTC ni el del
 * dispositivo (docs/TIME_CONTRACT.md). Anclar al día UTC caduca el plus a
 * medianoche de Londres para un gimnasio de La Habana.
 *
 * **Esta función es gemela de la de `gym-remote-api`. Si cambia una, cambia la
 * otra**, o el escritorio dejaría entrar a quien la web rechaza. La prueba de
 * paridad de la raíz compara los dos ficheros enteros.
 */
import { createHash } from "crypto";

/**
 * Vigencia del plus, en meses. Mensual por decisión del dueño (§9, segunda
 * ronda, respuesta 4) y **con independencia de la duración del plan**: un plan
 * trimestral no arrastra tres meses de acceso a otras sedes.
 */
export const ACCESO_MULTISEDE_MESES = 1;

/**
 * Identificador determinista del acceso de un socio.
 *
 * Sale de la identificación y no de un aleatorio por la misma razón que
 * `usuarioSedeId`: la fila puede nacer en cualquiera de las dos bases y después
 * viaja. Con claves aleatorias, marcar al mismo socio desde el escritorio y
 * desde la web produciría dos filas que la sincronización no sabría que son la
 * misma cosa —y la huella de paridad daría igualdad, porque la duplicación se
 * habría replicado fielmente—.
 */
export function accesoMultisedeId(ci: string): string {
  const clave = `gymos-m4-acceso|${ci.trim()}`;
  return `cam-${createHash("sha256").update(clave).digest("hex").slice(0, 32)}`;
}

/** Día de calendario UTC de un instante, sin hora (docs/TIME_CONTRACT.md §4). */
function calendarDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/**
 * Fin de vigencia al marcar o renovar el plus, **exclusivo**.
 *
 * Suma meses de calendario, no 30 días: el plus se cobra mensualmente y un
 * socio marcado el 31 de enero tiene que vencer con febrero, no arrastrar el
 * desfase. Cuando el día no existe en el mes destino —31 de enero + 1 mes— se
 * ancla al último día de ese mes, que es lo que hace cualquier calendario y lo
 * que espera quien lo cobra.
 */
export function vigenciaHastaDesde(
  desde: Date,
  meses: number = ACCESO_MULTISEDE_MESES,
): Date {
  const inicio = calendarDay(desde);
  const año = inicio.getUTCFullYear();
  const mes = inicio.getUTCMonth() + meses;
  const dia = inicio.getUTCDate();
  const ultimoDiaDelMesDestino = new Date(Date.UTC(año, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(año, mes, Math.min(dia, ultimoDiaDelMesDestino)));
}

/**
 * Fin de vigencia al marcar o al renovar, **encadenando**.
 *
 * Si el plus todavía cubre, el mes nuevo empieza donde termina el anterior; si
 * ya caducó, empieza hoy. Es la misma regla que la renovación de membresías
 * —«encadena un periodo que empieza justo donde termina el vigente»— y por la
 * misma razón: renovar antes de tiempo no puede costar los días que quedaban.
 * Quien paga el 10 un plus que vencía el 15 tiene derecho a esos cinco días.
 *
 * Al revés tampoco: un plus caducado hace tres meses no arrastra los tres meses
 * muertos, o el socio pagaría por un acceso que no tuvo.
 */
export function proximaVigencia(input: {
  /** Fin de vigencia actual, si ya tenía plus. */
  vigenteHastaActual: Date | string | null | undefined;
  /** Fecha de negocio del gimnasio, no la del dispositivo. */
  fechaNegocio: Date;
  meses?: number;
}): Date {
  const meses = input.meses ?? ACCESO_MULTISEDE_MESES;
  const hoy = calendarDay(input.fechaNegocio);
  const actual =
    input.vigenteHastaActual == null ? null : new Date(input.vigenteHastaActual);
  const ancla =
    actual && !Number.isNaN(actual.getTime()) && calendarDay(actual) > hoy
      ? calendarDay(actual)
      : hoy;
  return vigenciaHastaDesde(ancla, meses);
}

/** La fila de acceso tal y como hace falta para decidir. */
export type AccesoMultisede = {
  activo: boolean;
  /** Fin de vigencia EXCLUSIVO: el primer día que ya no cubre. */
  vigente_hasta: Date | string | null | undefined;
  is_deleted?: boolean | null;
};

/**
 * ¿El plus cubre hoy?
 *
 * Falla cerrado a propósito: sin fila, retirada, desactivada o con una fecha
 * ilegible, la respuesta es que no cubre. Lo que está en juego es quién entra a
 * un local, y ahí un dato que no se entiende no puede valer como permiso.
 */
export function accesoCubre(
  acceso: AccesoMultisede | null | undefined,
  fechaNegocio: Date,
): boolean {
  if (!acceso || acceso.is_deleted || !acceso.activo) return false;
  if (acceso.vigente_hasta == null) return false;
  const hasta = new Date(acceso.vigente_hasta);
  if (Number.isNaN(hasta.getTime())) return false;
  // Exclusiva: cubre mientras hoy sea ANTERIOR al día de fin.
  return calendarDay(fechaNegocio).getTime() < calendarDay(hasta).getTime();
}

export type DecisionVisita =
  /** El socio pertenece a esta sede: el plus no pinta nada. */
  | { resultado: "SOCIO_PROPIO" }
  /** Socio de otra sede con el plus vigente: se le atiende como visitante. */
  | { resultado: "VISITANTE"; gymIdDeOrigen: string }
  | { resultado: "BLOQUEADA"; status: 409; motivo: string };

export const MOTIVO_SIN_ACCESO_MULTISEDE =
  "El socio pertenece a otra sede y no tiene contratado el acceso multi-sede.";
export const MOTIVO_ACCESO_MULTISEDE_VENCIDO =
  "El acceso multi-sede del socio venció. Renuévelo para permitir la entrada en esta sede.";

/**
 * Decide cómo tratar a un socio en la sede donde se le está atendiendo.
 *
 * El orden importa y es deliberado:
 *
 * 1. **Socio propio primero.** Un socio de esta sede entra con su plan y no se
 *    le pregunta por el plus. Comprobar el plus antes dejaría fuera a todo el
 *    padrón el día que el plus tenga un fallo.
 * 2. **Socio sin sede conocida cuenta como propio.** Las filas anteriores al
 *    multi-sede no tienen `gym_id`, y tratarlas como visitantes bloquearía a
 *    medio padrón heredado por un dato que nunca se les pidió.
 * 3. **Solo entonces se mira el plus**, y se distingue «no lo tiene» de «se le
 *    venció», porque la primera se resuelve vendiéndolo y la segunda cobrando
 *    la renovación.
 */
export function decidirVisita(input: {
  /** Sede dueña del socio: `cliente.gym_id`. */
  gymIdDelSocio: string | null | undefined;
  /** Sede que está atendiendo ahora mismo. */
  gymIdDeLaSede: string;
  /** Acceso multi-sede del socio, si lo tiene. */
  acceso: AccesoMultisede | null | undefined;
  /** Fecha de negocio del gimnasio, no la del dispositivo. */
  fechaNegocio: Date;
}): DecisionVisita {
  const origen = String(input.gymIdDelSocio ?? "").trim();
  if (!origen || origen === String(input.gymIdDeLaSede ?? "").trim()) {
    return { resultado: "SOCIO_PROPIO" };
  }
  if (!input.acceso || input.acceso.is_deleted || !input.acceso.activo) {
    return {
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_SIN_ACCESO_MULTISEDE,
    };
  }
  if (!accesoCubre(input.acceso, input.fechaNegocio)) {
    return {
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_ACCESO_MULTISEDE_VENCIDO,
    };
  }
  return { resultado: "VISITANTE", gymIdDeOrigen: origen };
}

/** La copia de solo lectura, tal y como hace falta para decidir si sirve. */
export type CopiaVisitante = {
  gym_id_origen: string | null | undefined;
  is_deleted?: boolean | null;
};

/**
 * ¿Esta copia le sirve a la sede que la está leyendo?
 *
 * La réplica llega a **todas** las instalaciones, incluida la de origen. Que la
 * sede dueña también la guarde es deliberado —es una proyección, y tenerla en
 * todas las bases es lo que permite compararlas—, pero **leerla ahí sería un
 * error**: para sus propios socios manda `cliente`, que es el dato vivo. Dos
 * fuentes para la misma persona en la misma base terminan discrepando, y la
 * copia siempre es la más vieja de las dos.
 */
export function esVisitanteDeOtraSede(
  visitante: CopiaVisitante | null | undefined,
  gymIdLocal: string,
): boolean {
  if (!visitante || visitante.is_deleted) return false;
  const origen = String(visitante.gym_id_origen ?? "").trim();
  return origen.length > 0 && origen !== String(gymIdLocal ?? "").trim();
}

/**
 * ¿Debe esta sede conservar la copia de solo lectura de este socio?
 *
 * Es el camino de vuelta que pide §9-bis: como quien deja de pagar el plus
 * pierde el acceso, **la caducidad tiene que retirar la réplica**. Sin esto,
 * cada sede acumularía para siempre a todos los que alguna vez lo pagaron, y la
 * lista de socios de una sede acabaría siendo la de la cadena entera.
 */
export function debeReplicarse(
  acceso: AccesoMultisede | null | undefined,
  fechaNegocio: Date,
): boolean {
  return accesoCubre(acceso, fechaNegocio);
}
