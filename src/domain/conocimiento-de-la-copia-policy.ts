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

/**
 * Cuánto hace que se supo de **la sede del socio** (§5.2, segundo eje).
 *
 * ## Por qué no basta con el primero
 *
 * `conocimientoDeLaSede` mide la distancia entre **quien decide** y el
 * concentrador. Contesta «¿he hablado con la red hoy?», y con eso una sede al
 * día se cree autorizada a afirmar. Pero el concentrador no inventa el estado
 * del visitante: lo sabe porque **la sede del socio lo subió**. Si esa lleva
 * tres días muda, el dato que baja es de hace tres días por más al día que esté
 * quien pregunta.
 *
 * Son dos ejes independientes y fallan por separado:
 *
 * | esta sede | la del socio | qué vale la respuesta |
 * |---|---|---|
 * | al día | al día | lo que dice, dice |
 * | al día | muda | **fresca de mentira**: viene del concentrador, pero es vieja |
 * | muda | al día | se decide con la copia, y eso ya se declaraba |
 * | muda | muda | ni se sabe: sin línea no llega esta medida |
 *
 * La segunda fila es la que este eje destapa, y era la que nadie decía.
 *
 * ## Solo se sabe con línea
 *
 * La mide el concentrador y viaja en la respuesta viva. Sin conexión no llega
 * —la copia no la trae— y entonces se responde `NO_CONSTA`, que **no** es «está
 * al día»: es «no lo sé», y confundirlos sería inventarse una tranquilidad.
 */
export type NoticiaDeOrigen =
  | "AL_DIA"
  | "CON_RETRASO"
  | "A_CIEGAS"
  | "NO_CONSTA";

export interface ConocimientoDeLaSedeDeOrigen {
  readonly noticia: NoticiaDeOrigen;
  /** Días de negocio desde la última noticia. `null` si no consta. */
  readonly diasSinNoticias: number | null;
  readonly advertencia: string | null;
}

/**
 * Clasifica cuánto hace que se supo de la sede del socio.
 *
 * Se mide contra el día de negocio de **quien pregunta**, igual que el otro eje
 * y por el mismo motivo: la pregunta del mostrador es «¿esto que tengo delante
 * es de hoy?», y hoy es el suyo.
 */
export function conocimientoDeLaSedeDeOrigen(input: {
  readonly ultimaNoticia: Date | null | undefined;
  readonly fechaNegocio: Date;
}): ConocimientoDeLaSedeDeOrigen {
  const ultima = input.ultimaNoticia ?? null;
  if (!ultima || Number.isNaN(ultima.getTime())) {
    return { noticia: "NO_CONSTA", diasSinNoticias: null, advertencia: null };
  }

  const dias = Math.max(0, Math.round((dia(input.fechaNegocio) - dia(ultima)) / DIA_MS));
  if (dias === 0) {
    return { noticia: "AL_DIA", diasSinNoticias: 0, advertencia: null };
  }
  if (dias === 1) {
    return {
      noticia: "CON_RETRASO",
      diasSinNoticias: 1,
      advertencia:
        "La sede de este socio no da noticias desde ayer: una baja de hoy " +
        "allí no ha llegado todavía ni al concentrador.",
    };
  }
  return {
    noticia: "A_CIEGAS",
    diasSinNoticias: dias,
    advertencia:
      `La sede de este socio lleva ${dias} días sin dar noticias: lo que se ` +
      "sabe de él es de entonces, aunque esta sede esté al día.",
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
   * Lo que la respuesta puede afirmar.
   *
   * Nulo solo cuando de verdad no hay nada que matizar: decidió el concentrador
   * **y** la sede del socio está al día. Que contestara el concentrador ya no
   * basta para callar —su dato es tan reciente como la última subida de esa
   * sede— y callar sobre una foto de hace tres días suena a comprobado.
   */
  readonly advertencia: string | null;
  /** Segundo eje: cuánto hace que se supo de la sede del socio. */
  readonly origen: ConocimientoDeLaSedeDeOrigen;
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
const SIN_NOTICIA_DE_ORIGEN: ConocimientoDeLaSedeDeOrigen = {
  noticia: "NO_CONSTA",
  diasSinNoticias: null,
  advertencia: null,
};

export function decidirConQueSeResuelve(input: {
  readonly copia: EstadoDelVisitante;
  readonly enVivo: (EstadoDelVisitante & { readonly existe: boolean }) | null;
  readonly conocimiento: ConocimientoDeLaSede;
  /**
   * Cuánto hace que se supo de la sede del socio, cuando se sabe. Solo llega
   * con la respuesta del concentrador: sin línea no hay quien lo mida.
   */
  readonly origen?: ConocimientoDeLaSedeDeOrigen;
}): DecisionConFuente {
  const vivo = input.enVivo;
  if (vivo) {
    const origen = input.origen ?? SIN_NOTICIA_DE_ORIGEN;
    return {
      estado: vivo.existe
        ? { membresiaEstado: vivo.membresiaEstado, membresiaFechaFin: vivo.membresiaFechaFin }
        : { membresiaEstado: null, membresiaFechaFin: null },
      fuente: "CONCENTRADOR",
      // El dato es el de origen en este instante… si esa sede ha hablado. Si
      // lleva días muda, lo que llega es su última foto y hay que decirlo.
      advertencia: origen.advertencia,
      origen,
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
    // Sin respuesta no se sabe nada de la sede del socio, y `NO_CONSTA` lo dice
    // sin fingir que se comprobó.
    origen: SIN_NOTICIA_DE_ORIGEN,
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
  /**
   * El segundo eje, congelado igual que el primero: cuánto hacía que se sabía
   * de la sede del socio. `NO_CONSTA` cuando no se pudo medir —sin línea no
   * llega—, que no es lo mismo que estar al día.
   */
  readonly conocimientoOrigen: NoticiaDeOrigen;
  readonly diasSinNoticiasOrigen: number | null;
}

export function rastroDeLaDecision(input: {
  readonly fuente: FuenteDeLaDecision;
  readonly conocimiento: ConocimientoDeLaSede;
  readonly origen?: ConocimientoDeLaSedeDeOrigen;
}): RastroDeLaDecision {
  return {
    decididoCon: input.fuente,
    conocimiento: input.conocimiento.frescura,
    diasSinNoticias: input.conocimiento.diasSinNoticias,
    conocimientoOrigen: input.origen?.noticia ?? "NO_CONSTA",
    diasSinNoticiasOrigen: input.origen?.diasSinNoticias ?? null,
  };
}

/**
 * El rastro de una entrada decidida **en el propio concentrador** (la web).
 *
 * Ahí la pregunta que mide `conocimientoDeLaSede` —«¿cuánto hace que bajé
 * datos?»— no tiene sentido: el concentrador no baja nada, es el origen. Cero
 * días, y la fuente es él mismo.
 *
 * **Lo que la primera columna no afirma:** que la sede del socio esté al día.
 * Eso es el segundo eje, y desde el 20-08-2026 viaja aparte en vez de darse por
 * supuesto: una sola casilla que quisiera decir las dos cosas no diría bien
 * ninguna.
 */
export function rastroDelConcentrador(
  origen?: ConocimientoDeLaSedeDeOrigen,
): RastroDeLaDecision {
  return {
    decididoCon: "CONCENTRADOR",
    conocimiento: "AL_DIA",
    diasSinNoticias: 0,
    // El segundo eje **sí** aplica en la web: el concentrador está al día
    // consigo mismo, no con la sede del socio. Era justo lo que la constante
    // que había aquí antes no podía decir.
    conocimientoOrigen: origen?.noticia ?? "NO_CONSTA",
    diasSinNoticiasOrigen: origen?.diasSinNoticias ?? null,
  };
}
