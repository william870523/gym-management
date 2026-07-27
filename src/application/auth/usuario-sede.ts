import { createHash } from "crypto";

/**
 * Identificador determinista de una membresía usuario↔sede
 * (docs/MULTI_SEDE.md §3.2).
 *
 * Tiene que salir del par `user_id|gym_id` y no de un aleatorio: la fila nace
 * en la base que la cree —o en el backfill de cada base, que corre por
 * separado— y después viaja por sincronización. Con un id aleatorio, las dos
 * bases generarían dos filas distintas para la misma persona y sede, y la
 * unicidad `(user_id, gym_id)` rechazaría la que llegara segunda.
 *
 * **Esta función es gemela de la de `gym-local-api`. Si cambia una, cambia la
 * otra**, o las dos bases dejarán de calcular el mismo identificador. La
 * prueba `usuario-sede.test.ts` fija un valor conocido en ambos lados.
 */
export function usuarioSedeId(userId: string, gymId: string): string {
    const clave = `${userId.trim()}|${gymId.trim()}`;
    return `us-${createHash("sha256").update(clave).digest("hex").slice(0, 32)}`;
}
