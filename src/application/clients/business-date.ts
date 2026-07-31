/**
 * Fecha de negocio de una sede: el día de calendario tal como se ve en la zona
 * del gimnasio, devuelto como instante UTC a medianoche.
 *
 * La API remota es multi-sede, así que la zona no puede salir de una variable
 * de entorno global: sale del `Gym` al que pertenece la operación
 * (`docs/TIME_CONTRACT.md`). El proceso arranca con TZ=UTC y nadie consulta la
 * zona del servidor.
 */
import { env } from "../../config/env";
import { datePartsInZone } from "../../config/tz";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";

export async function fechaNegocioDeSede(
    gymId: string,
    instante: Date = trustedClock.nowUtc(),
): Promise<Date> {
    const gym = await prisma.gym.findUnique({
        where: { gym_id: gymId },
        select: { timezone: true },
    });
    const zona = gym?.timezone?.trim() || env.defaultGymTimezone;
    const partes = datePartsInZone(zona, instante);
    return new Date(Date.UTC(partes.year, partes.month - 1, partes.day));
}
