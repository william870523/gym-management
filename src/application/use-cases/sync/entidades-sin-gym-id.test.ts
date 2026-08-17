import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ENTIDADES_SIN_COLUMNA_GYM_ID,
  PARITY_SYNC_TARGET_DEFINITIONS,
} from "./sync-event-contract";

/**
 * Este barrido nace de un fallo real de M4a, y de que **ninguna prueba lo vio**.
 *
 * El camino de escritura de la cola llama a `buildAuthoritativeGymRecord`, que
 * estampa `gym_id` sobre el registro **siempre**, porque hasta M4a todo lo que
 * pasaba por ahí era dato de sede. `cliente_visitante` no tiene esa columna —su
 * sede vive en `gym_id_origen`—, así que Prisma respondía
 * `PrismaClientValidationError` y, por el orden estricto de la cola, el evento
 * paraba todo lo que venía detrás.
 *
 * Las pruebas del contrato pasaban porque ejercitan
 * `buildAuthenticatedSyncPayload`, que construye el payload del `sync_log`, no
 * el registro que se escribe. Dos funciones que se parecen y hacen cosas
 * distintas: exactamente el sitio donde una prueba de más no sobra.
 *
 * Por eso esto no comprueba comportamiento, sino **coherencia entre el esquema
 * y lo declarado**: si alguien añade una entidad sin `gym_id` y se olvida de
 * declararla, cae aquí y no en la cola de un gimnasio.
 */
const ESQUEMA = readFileSync(
  resolve(import.meta.dir, "../../../../prisma/schema.prisma"),
  "utf8",
);

/** Bloque `model X { … }` del esquema, por nombre de modelo Prisma. */
function cuerpoDelModelo(modelo: string): string {
  const inicio = ESQUEMA.indexOf(`model ${modelo} {`);
  if (inicio < 0) throw new Error(`El esquema no declara el modelo ${modelo}.`);
  const fin = ESQUEMA.indexOf("\n}", inicio);
  return ESQUEMA.slice(inicio, fin);
}

const modeloDeDelegado = (delegateKey: string) =>
  delegateKey.charAt(0).toUpperCase() + delegateKey.slice(1);

describe("entidades de sync sin columna gym_id", () => {
  it("lo declarado coincide con lo que el esquema dice, entidad por entidad", () => {
    const sinColumnaSegunEsquema: string[] = [];
    for (const [entidad, definicion] of Object.entries(
      PARITY_SYNC_TARGET_DEFINITIONS,
    )) {
      const cuerpo = cuerpoDelModelo(modeloDeDelegado(definicion.delegateKey));
      const declaraGymId = /^\s*gym_id\s+\S/m.test(cuerpo);
      if (!declaraGymId) sinColumnaSegunEsquema.push(entidad);
    }
    expect(sinColumnaSegunEsquema.sort()).toEqual(
      [...ENTIDADES_SIN_COLUMNA_GYM_ID].sort(),
    );
  });

  it("la copia del visitante lleva su sede en `gym_id_origen`, no en `gym_id`", () => {
    const cuerpo = cuerpoDelModelo("ClienteVisitante");
    expect(/^\s*gym_id_origen\s+\S/m.test(cuerpo)).toBe(true);
    expect(/^\s*gym_id\s+\S/m.test(cuerpo)).toBe(false);
    expect(ENTIDADES_SIN_COLUMNA_GYM_ID.has("cliente_visitante")).toBe(true);
  });

  it("el acceso multi-sede sí tiene `gym_id`: es la sede dueña del socio", () => {
    // El contraste importa: son las dos entidades nuevas de M4a y se tratan al
    // revés. Si alguien las igualara «por simetría», o el visitante rompería la
    // cola o el acceso perdería a su dueño.
    const cuerpo = cuerpoDelModelo("ClienteAccesoMultisede");
    expect(/^\s*gym_id\s+\S/m.test(cuerpo)).toBe(true);
    expect(ENTIDADES_SIN_COLUMNA_GYM_ID.has("cliente_acceso_multisede")).toBe(false);
  });
});
