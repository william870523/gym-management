/**
 * Quién puede marcar entrada, y por qué no.
 *
 * La regla vivía suelta dentro del servicio de asistencia del ESCRITORIO, y el
 * remoto no la tenía en absoluto: `CreateAsistenciaUseCase` solo comprobaba que
 * el socio fuera del gimnasio. Desde el navegador se podía registrar la entrada
 * de un socio pausado, pendiente de pago o con la cuota vencida —y registrarla
 * dos veces—, saltándose todo lo que el mostrador sí respeta.
 *
 * Por eso la decisión se saca aquí, a una política de dominio **gemela en las
 * dos APIs**: es lo que impide que una regla de negocio exista en una superficie
 * y no en la otra. La política no toca la base ni el reloj; recibe los hechos ya
 * leídos y decide.
 *
 * El orden de comprobación importa y es el que tenía el escritorio: primero la
 * pausa, después el pago pendiente, y solo entonces la mora por cuotas.
 */

/** Estados de membresía que dan derecho de acceso o lo explican. */
export type MembresiaParaEntrada = {
  estado: string;
  /**
   * Fin de cobertura EXCLUSIVO (`membresia_cliente.fecha_fin`).
   *
   * **Sin esto, la regla se creía el `estado` y dejaba pasar a quien no había
   * pagado.** `estado` registra el acto —se activó— y nadie escribe nunca
   * `VENCIDA` (ver `membership-vigencia.ts`), así que una cobertura terminada
   * en marzo sigue diciendo `ACTIVA` en agosto. Comprobado por HTTP el
   * 16-08-2026: un socio cuya cobertura acabó el 2 de marzo registró entrada
   * con 201. En esa base eran 67 socios.
   *
   * Opcional solo por compatibilidad: una membresía sin fecha no puede
   * declararse vencida y se comporta como antes.
   */
  fechaFin?: Date | string | null;
  /**
   * Bloqueo por cuota vencida, ya evaluado contra el día de negocio y la gracia
   * configurada. `null` cuando la membresía no se contrató por cuotas.
   */
  bloqueoPorCuota?: { bloqueada: boolean; motivo: string | null } | null;
};

export type DecisionEntrada =
  /** Ya hay una entrada abierta: repetir la operación devuelve la misma fila. */
  | { resultado: "YA_DENTRO" }
  | { resultado: "PERMITIDA" }
  | { resultado: "BLOQUEADA"; status: 409; motivo: string };

export const MOTIVO_PAUSADA =
  "La membresía está pausada. Reanúdela antes de registrar la entrada.";
export const MOTIVO_PENDIENTE_PAGO =
  "La membresía está pendiente de pago. Registre el cobro antes de permitir la entrada.";
export const MOTIVO_CUOTA_VENCIDA = "Cuota vencida.";
export const MOTIVO_COBERTURA_VENCIDA =
  "La membresía terminó su cobertura. Registre la renovación antes de permitir la entrada.";

export function decidirEntrada(input: {
  /** ¿El socio ya tiene una asistencia sin salida registrada? */
  tieneEntradaAbierta: boolean;
  /** Membresías vivas del socio en estado ACTIVA, PAUSADA o PENDIENTE_PAGO. */
  membresias: MembresiaParaEntrada[];
  /**
   * Fecha de negocio del gimnasio (docs/TIME_CONTRACT.md), para decidir si la
   * cobertura llega a hoy. Opcional: sin ella la regla no puede hablar de
   * fechas y se comporta como antes de M4a.
   */
  fechaNegocio?: Date;
}): DecisionEntrada {
  if (input.tieneEntradaAbierta) return { resultado: "YA_DENTRO" };

  const estado = (m: MembresiaParaEntrada) => String(m.estado ?? "").toUpperCase();
  const activas = input.membresias.filter((m) => estado(m) === "ACTIVA");

  // Compatibilidad: los socios antiguos que aún no tienen contrato histórico
  // pueden entrar. Sin esto, cerrar la regla dejaría fuera a medio padrón.
  if (input.membresias.length === 0) return { resultado: "PERMITIDA" };

  if (activas.length === 0) {
    if (input.membresias.some((m) => estado(m) === "PAUSADA")) {
      return { resultado: "BLOQUEADA", status: 409, motivo: MOTIVO_PAUSADA };
    }
    if (input.membresias.some((m) => estado(m) === "PENDIENTE_PAGO")) {
      return { resultado: "BLOQUEADA", status: 409, motivo: MOTIVO_PENDIENTE_PAGO };
    }
    return { resultado: "PERMITIDA" };
  }

  // La cobertura manda sobre el estado guardado. `fecha_fin` es EXCLUSIVA: el
  // día que figura es el primero que ya no cubre.
  const cubren = input.fechaNegocio
    ? activas.filter((m) => cubreHoy(m.fechaFin, input.fechaNegocio!))
    : activas;
  if (cubren.length === 0) {
    return {
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_COBERTURA_VENCIDA,
    };
  }

  // R5.2: con membresía activa contratada por cuotas, la mora cierra el paso.
  // Solo cuentan las que cubren hoy: una vencida ya bloqueó por su cuenta, y
  // dejarla opinar aquí cambiaría el motivo por uno que no explica nada.
  for (const membresia of cubren) {
    const bloqueo = membresia.bloqueoPorCuota;
    if (bloqueo?.bloqueada) {
      return {
        resultado: "BLOQUEADA",
        status: 409,
        motivo: bloqueo.motivo ?? MOTIVO_CUOTA_VENCIDA,
      };
    }
  }

  return { resultado: "PERMITIDA" };
}

export const MOTIVO_VISITANTE_SIN_COPIA =
  "No hay datos de la membresía del socio en su sede de origen. Espere a que sincronice antes de permitir la entrada.";

/**
 * Entrada de un **socio de otra sede** (M4a, docs/MULTI_SEDE.md §5.2).
 *
 * La sede visitada no tiene las membresías del visitante —no se replican— sino
 * la copia de solo lectura, que trae el estado y el fin de cobertura en origen.
 * Con eso se decide **exactamente igual que con un socio propio**, y a
 * propósito: la regla de quién entra no puede tener dos versiones según de
 * dónde venga la persona.
 *
 * Dos cosas que conviene dejar dichas:
 *
 * - **Sin copia no se entra.** Falla cerrado: es preferible pedirle que espere
 *   a la sincronización que dejar pasar a quien a lo mejor no ha pagado.
 * - **La mora por cuotas del visitante no se evalúa aquí.** Sus cuotas viven en
 *   su sede y no viajan; la copia no las trae. Es un límite consciente de la
 *   etapa 1: quien controla la mora del plan es la sede que lo vendió.
 */
export function decidirEntradaVisitante(input: {
  tieneEntradaAbierta: boolean;
  /** Resultado de `decidirVisita`: si el plus multi-sede autoriza la visita. */
  visita: { resultado: string; status?: number; motivo?: string };
  /** Copia de solo lectura del socio, tal y como bajó por sincronización. */
  copia:
    | {
        membresia_estado?: string | null;
        membresia_fecha_fin?: Date | string | null;
      }
    | null
    | undefined;
  fechaNegocio: Date;
}): DecisionEntrada {
  if (input.tieneEntradaAbierta) return { resultado: "YA_DENTRO" };

  if (input.visita.resultado === "BLOQUEADA") {
    return {
      resultado: "BLOQUEADA",
      status: 409,
      motivo: input.visita.motivo ?? MOTIVO_SIN_MEMBRESIA_VISITANTE_DESCONOCIDA,
    };
  }

  if (!input.copia) {
    return {
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_VISITANTE_SIN_COPIA,
    };
  }

  const estado = String(input.copia.membresia_estado ?? "").trim();
  // Sin membresía conocida en origen no hay derecho que reconocer. El caso
  // «socio antiguo sin contrato» de `decidirEntrada` no aplica: aquel es un
  // socio de la casa, y a este no lo conoce nadie en el mostrador.
  if (!estado) {
    return {
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_VISITANTE_SIN_COPIA,
    };
  }

  return decidirEntrada({
    tieneEntradaAbierta: false,
    membresias: [{ estado, fechaFin: input.copia.membresia_fecha_fin ?? null }],
    fechaNegocio: input.fechaNegocio,
  });
}

const MOTIVO_SIN_MEMBRESIA_VISITANTE_DESCONOCIDA =
  "El socio no tiene acceso multi-sede vigente.";

/** Día de calendario UTC de un instante, sin hora. */
function diaCalendario(valor: Date): Date {
  return new Date(
    Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate()),
  );
}

/**
 * ¿La cobertura llega a hoy? Sin fecha conocida se responde que sí, que es el
 * comportamiento heredado: no se puede declarar vencido lo que no tiene fin.
 */
function cubreHoy(
  fechaFin: Date | string | null | undefined,
  fechaNegocio: Date,
): boolean {
  if (fechaFin == null) return true;
  const fin = new Date(fechaFin);
  if (Number.isNaN(fin.getTime())) return true;
  return diaCalendario(fechaNegocio).getTime() < diaCalendario(fin).getTime();
}
