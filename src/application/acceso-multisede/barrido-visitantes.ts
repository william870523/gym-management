/**
 * Ejecutor del barrido de caducidad de copias de visitante (M4a).
 *
 * **Vive solo en el remoto, y no por comodidad.** La copia de un socio la
 * proyecta y la retira su sede de origen: la validación de subida exige que
 * `gym_id_origen` coincida con la sede del emisor. Si cada instalación barriera
 * por su cuenta, o emitiría bajas de socios ajenos —que el remoto rechazaría, y
 * atascaría su cola— o borraría filas sin evento y dejaría las dos bases
 * distintas. El concentrador las ve todas, así que barre él y las demás reciben
 * la baja por descarga.
 *
 * La simulación **ejecuta el mismo código** y deshace la transacción al final.
 * Un modo «solo mirar» escrito aparte acaba divergiendo del que escribe, y el
 * día que importe dirá que iba a hacer algo distinto de lo que hace.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../infrastructure/db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import { datePartsInZone } from "../../config/tz";
import { env } from "../../config/env";
import { barrerReplicasCaducadas } from "./acceso-multisede.service";

const DISPOSITIVO = "BARRIDO_MULTISEDE";

/** Marca interna para deshacer la transacción de una simulación. */
const SIMULACION = Symbol("simulación de barrido");

export type ResultadoBarrido = {
  revisadas: number;
  retiradas: string[];
  /** Copias que se conservan y cuya membresía de origen se puso al día. */
  refrescadas: string[];
  aplicado: boolean;
};

export async function barrerVisitantesCaducados(
  opciones: { aplicar?: boolean; alDia?: Date } = {},
): Promise<ResultadoBarrido> {
  const aplicar = opciones.aplicar === true;
  const nowUtc = trustedClock.nowUtc();
  // `alDia` responde a una pregunta de operación real —«¿a quién le caduca
  // el plus el 1 de octubre?»— y de paso permite ver el barrido trabajar sin
  // esperar semanas. No mueve el reloj de nada más: los instantes que se
  // escriben siguen saliendo de `trustedClock`.
  const instanteDeEvaluacion = opciones.alDia ?? nowUtc;

  const fechaNegocioDeSede = (timezone: string | null | undefined) => {
    const partes = datePartsInZone(
      timezone?.trim() || env.defaultGymTimezone,
      instanteDeEvaluacion,
    );
    return new Date(Date.UTC(partes.year, partes.month - 1, partes.day));
  };

  try {
    return await prisma.$transaction(async (tx) => {
      const resultado = await barrerReplicasCaducadas({
        tx,
        fechaNegocioDeSede,
        sourceDevice: DISPOSITIVO,
        nowUtc,
        // Aquí sí: el concentrador tiene las membresías de todas las sedes. En
        // una instalación esto vaciaría la copia del visitante, porque las
        // membresías ajenas no se replican.
        refrescarMembresia: true,
      });

      // Un evento por copia retirada, global para que llegue a todas las
      // sedes, y en la misma transacción que la fila.
      for (const fila of resultado.retiradas) {
        await tx.syncLog.create({
          data: {
            event_id: randomUUID(),
            entidad: "cliente_visitante",
            operacion: "DELETE",
            entidad_id: fila.ci,
            gym_id: null,
            payload_json: JSON.stringify(fila),
          },
        });
      }

      // Y uno por copia puesta al día. Sin esto el concentrador quedaría con la
      // cobertura correcta y las sedes con la vieja, que es la divergencia que
      // se estaba arreglando, solo que ahora silenciosa: las dos bases tendrían
      // la fila y diría cosas distintas.
      for (const fila of resultado.refrescadas) {
        await tx.syncLog.create({
          data: {
            event_id: randomUUID(),
            entidad: "cliente_visitante",
            operacion: "UPDATE",
            entidad_id: fila.ci,
            gym_id: null,
            payload_json: JSON.stringify(fila),
          },
        });
      }

      const salida: ResultadoBarrido = {
        revisadas: resultado.revisadas,
        retiradas: resultado.retiradas.map((f: any) => String(f.ci)),
        refrescadas: resultado.refrescadas.map((f: any) => String(f.ci)),
        aplicado: aplicar,
      };
      if (!aplicar) throw Object.assign(new Error("simulación"), { [SIMULACION]: salida });
      return salida;
    });
  } catch (error: any) {
    if (error && error[SIMULACION]) return error[SIMULACION] as ResultadoBarrido;
    throw error;
  }
}
