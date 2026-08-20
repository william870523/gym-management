/**
 * Cuánta confianza merece lo que esta sede sabe de un visitante
 * (docs/MULTI_SEDE.md §5.2).
 *
 * ## Por qué hace falta declarar esto
 *
 * La copia del visitante lleva la **vigencia**, no un «está activo», y eso es lo
 * que la hace servir sin conexión: caducar no necesita información nueva, porque
 * una fecha que ya pasó sigue pasada mañana. La sede calcula contra su propio día
 * de negocio y acierta aunque lleve dos días sin hablar con nadie.
 *
 * Pero no todo lo que pasa en la sede de origen es una caducidad. Si allí se
 * **canceló la membresía antes de tiempo**, o se renovó, eso solo llega por
 * sincronización. Con la sede desconectada, la copia sigue diciendo lo de antes:
 *
 * | qué pasó en origen | qué hace la sede sin noticias | |
 * |---|---|---|
 * | el plan venció | lo bloquea bien: la fecha ya la tenía | seguro |
 * | el socio renovó | lo bloquea igual, hasta sincronizar | molesta, no deja pasar de más |
 * | se canceló antes de tiempo | **lo deja entrar** | la ventana |
 *
 * Esta política **no cambia la decisión**, y esa es su regla principal. Negar la
 * entrada por llevar horas sin noticias dejaría a la sede sin poder atender a
 * nadie justo el día que se cae la conexión, que es lo contrario de para lo que
 * existe la lectura local. Lo que hace es **declarar**: la pantalla deja de
 * afirmar con la misma seguridad un dato de hace un minuto y uno de hace dos
 * días.
 *
 * ## Por qué se mide en días de negocio y no en horas
 *
 * Un umbral en horas es un número inventado. El día de negocio no: es la unidad
 * en la que el resto del proyecto decide caducidades, cierres y arqueos, y es la
 * que responde a la pregunta que de verdad importa —«¿he hablado con la red
 * **hoy**?»—. Una sede que sincronizó esta mañana sabe lo de hoy; una que
 * sincronizó anteayer no sabe lo de ayer.
 */

/** Qué tan al día está lo que la sede sabe. */
export type FrescuraDelConocimiento = "AL_DIA" | "CON_RETRASO" | "A_CIEGAS";

export interface ConocimientoDeLaSede {
  readonly frescura: FrescuraDelConocimiento;
  /** Días de negocio transcurridos desde la última bajada. `null` si nunca hubo. */
  readonly diasSinNoticias: number | null;
  /** Última vez que esta sede bajó datos del concentrador. */
  readonly ultimaSincronizacion: string | null;
  /**
   * Lo que la pantalla puede decir sin mentir. Vacío cuando está al día: no hay
   * nada que advertir y llenar la vista de avisos inofensivos enseña a
   * ignorarlos.
   */
  readonly advertencia: string | null;
}

/** Día de calendario de un instante, sin hora. */
function dia(valor: Date): number {
  return Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate());
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Clasifica la frescura de lo que la sede sabe.
 *
 * `fechaNegocio` es la de **esta** sede: dos sedes en husos distintos pueden
 * estar en días distintos con el mismo instante, y la pregunta «¿hablé hoy?» es
 * de cada una.
 */
export function conocimientoDeLaSede(input: {
  readonly ultimaSincronizacion: Date | null | undefined;
  readonly fechaNegocio: Date;
}): ConocimientoDeLaSede {
  const ultima = input.ultimaSincronizacion ?? null;
  if (!ultima || Number.isNaN(ultima.getTime())) {
    return {
      frescura: "A_CIEGAS",
      diasSinNoticias: null,
      ultimaSincronizacion: null,
      advertencia:
        "Esta sede no ha sincronizado nunca: lo que se ve de los visitantes no " +
        "ha llegado de sus sedes, y puede no existir.",
    };
  }

  const dias = Math.max(0, Math.round((dia(input.fechaNegocio) - dia(ultima)) / DIA_MS));
  const iso = ultima.toISOString();

  if (dias === 0) {
    return {
      frescura: "AL_DIA",
      diasSinNoticias: 0,
      ultimaSincronizacion: iso,
      advertencia: null,
    };
  }
  if (dias === 1) {
    return {
      frescura: "CON_RETRASO",
      diasSinNoticias: 1,
      ultimaSincronizacion: iso,
      advertencia:
        "Esta sede no sincroniza desde ayer: una baja o una renovación de hoy " +
        "en la sede del socio todavía no se ve aquí.",
    };
  }
  return {
    frescura: "A_CIEGAS",
    diasSinNoticias: dias,
    ultimaSincronizacion: iso,
    advertencia:
      `Esta sede lleva ${dias} días sin sincronizar: lo que se ve de los ` +
      "visitantes es la foto de entonces. Una membresía cancelada desde " +
      "entonces seguiría apareciendo vigente.",
  };
}

/** De dónde salió el dato con el que se decidió una entrada. */
export type FuenteDeLaDecision = "CONCENTRADOR" | "COPIA_LOCAL";

/** Lo mínimo que hace falta de un visitante para decidir su entrada. */
export interface EstadoDelVisitante {
  readonly membresiaEstado: string | null;
  readonly membresiaFechaFin: Date | null;
}

export interface DecisionConFuente {
  readonly estado: EstadoDelVisitante;
  readonly fuente: FuenteDeLaDecision;
  /**
   * Lo que la respuesta puede afirmar. Nulo cuando decidió el concentrador: ahí
   * no hay nada que matizar, el dato es el de origen en este instante.
   */
  readonly advertencia: string | null;
}

/**
 * Con qué dato se resuelve la entrada de un visitante (§5.2).
 *
 * **El concentrador manda cuando contesta.** Es la única forma de cerrar la
 * ventana de la cancelación anticipada: entre que la sede del socio da la baja
 * y la siguiente bajada, la copia local sigue diciendo `ACTIVA`.
 *
 * **Y la copia manda cuando no contesta**, sin negar la entrada. Bloquear
 * porque el concentrador no responde convertiría cada corte de red en un cierre
 * del gimnasio, que es lo contrario de para lo que existe la lectura local.
 * Entonces se decide con lo que hay y **se dice con qué se decidió**.
 *
 * Un caso merece atención: si el concentrador contesta que la copia **ya no
 * existe**, eso no es «no sé», es «se retiró». Se responde con la membresía
 * vacía, que las políticas de entrada ya saben leer como «no hay derecho que
 * reconocer».
 */
export function decidirConQueSeResuelve(input: {
  readonly copia: EstadoDelVisitante;
  readonly enVivo: (EstadoDelVisitante & { readonly existe: boolean }) | null;
  readonly conocimiento: ConocimientoDeLaSede;
}): DecisionConFuente {
  const vivo = input.enVivo;
  if (vivo) {
    return {
      estado: vivo.existe
        ? { membresiaEstado: vivo.membresiaEstado, membresiaFechaFin: vivo.membresiaFechaFin }
        : { membresiaEstado: null, membresiaFechaFin: null },
      fuente: "CONCENTRADOR",
      advertencia: null,
    };
  }
  return {
    estado: input.copia,
    fuente: "COPIA_LOCAL",
    // Se reutiliza la advertencia de la frescura en vez de escribir otra: dos
    // textos para el mismo riesgo acaban diciendo cosas distintas.
    advertencia:
      input.conocimiento.advertencia ??
      "El concentrador no contestó: se decidió con lo que esta sede tenía guardado.",
  };
}

/**
 * Lo que queda **escrito en la entrada** sobre con qué se decidió (§5.2).
 *
 * ## Por qué se guarda, si ya se dice
 *
 * La advertencia dura lo que dura el aviso en pantalla. Después, la fila de
 * asistencia de una entrada autorizada a ciegas es **idéntica** a la de una
 * decidida contra el dato vivo. El día que vuelve la sincronización y aparece
 * que aquel socio estaba dado de baja desde el martes, no hay forma de saber
 * cuáles se autorizaron sin poder comprobarlo: o se revisan todas o ninguna.
 *
 * ## Por qué se congela el juicio y no solo el número
 *
 * `conocimiento` es la clasificación de `diasSinNoticias` con los umbrales de
 * hoy. Guardar solo los días y volver a clasificarlos al leerlos **relabelaría
 * entradas viejas** el día que los umbrales cambien: una entrada decidida «con
 * retraso» pasaría a leerse «a ciegas» sin que nadie tocara esa fila, y el
 * rastro dejaría de decir lo que se supo entonces. Se guardan los dos, el hecho
 * y el juicio que se hizo con él, por el mismo motivo por el que un certificado
 * guarda el texto que se selló y no una reconstrucción.
 */
export interface RastroDeLaDecision {
  readonly decididoCon: FuenteDeLaDecision;
  readonly conocimiento: FrescuraDelConocimiento;
  /** `null` cuando la sede no había sincronizado nunca. */
  readonly diasSinNoticias: number | null;
}

export function rastroDeLaDecision(input: {
  readonly fuente: FuenteDeLaDecision;
  readonly conocimiento: ConocimientoDeLaSede;
}): RastroDeLaDecision {
  return {
    decididoCon: input.fuente,
    conocimiento: input.conocimiento.frescura,
    diasSinNoticias: input.conocimiento.diasSinNoticias,
  };
}

/**
 * El rastro de una entrada decidida **en el propio concentrador** (la web).
 *
 * Ahí la pregunta que mide `conocimientoDeLaSede` —«¿cuánto hace que bajé
 * datos?»— no tiene sentido: el concentrador no baja nada, es el origen. Cero
 * días, y la fuente es él mismo.
 *
 * **Lo que este rastro no afirma:** que la sede del socio esté al día. Una sede
 * muda deja su copia parada también aquí, y eso se mide en otro eje —el
 * semáforo de M5— que no se mezcla en esta columna: una sola casilla que
 * quisiera decir las dos cosas no diría bien ninguna.
 */
export const RASTRO_DEL_CONCENTRADOR: RastroDeLaDecision = {
  decididoCon: "CONCENTRADOR",
  conocimiento: "AL_DIA",
  diasSinNoticias: 0,
};
