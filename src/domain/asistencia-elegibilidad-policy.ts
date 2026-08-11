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

export function decidirEntrada(input: {
  /** ¿El socio ya tiene una asistencia sin salida registrada? */
  tieneEntradaAbierta: boolean;
  /** Membresías vivas del socio en estado ACTIVA, PAUSADA o PENDIENTE_PAGO. */
  membresias: MembresiaParaEntrada[];
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

  // R5.2: con membresía activa contratada por cuotas, la mora cierra el paso.
  // Basta que UNA activa esté bloqueada: no se puede entrar a cuenta de otra.
  for (const membresia of activas) {
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
