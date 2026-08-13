import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

/**
 * Barrido de atomicidad: **quien escribe una fila y registra su evento tiene que
 * hacerlo en la misma transacción**.
 *
 * Es el punto que la hoja de ruta R5-P nombra —«hacer atómico el upload
 * entidad+`sync_log`, endurecer también los handlers dedicados»— y el límite
 * escrito de dos capacidades: `sedes, usuarios y catálogos` y `alta/edición de
 * cliente`.
 *
 * Qué pasa si no se cumple: la fila queda escrita y el evento no nace. Nadie lo
 * nota. La fila existe, así que ninguna comprobación de integridad la señala; el
 * evento no existe, así que la cola no tiene qué reintentar. El escritorio no se
 * entera nunca y las dos bases quedan distintas para siempre. Es el crédito
 * huérfano del 12-08 con los papeles cambiados: allí llegó el hijo sin el padre,
 * aquí se queda el dato sin su rastro.
 *
 * El barrido no nombra ficheros. Recorre los directorios y exige que cada uno
 * que registre eventos tenga alguna de las cuatro formas de transacción que usa
 * la casa. Se escribe así porque la prueba hermana de `runInClient` cubría dos
 * repositorios **por su nombre** y por eso se escapó el tercero, que llevaba
 * meses roto.
 */
const RAIZ = resolve(import.meta.dir, "../..");

const DIRECTORIOS = ["application", "infrastructure/http/controllers"];

/** Las cuatro formas legítimas de estar dentro de una transacción. */
const MARCAS = [
  "enTransaccion", // ejecutor inyectado, el patrón nuevo
  "runTransaction", // ejecutor inyectado, nombre anterior
  "$transaction", // transacción abierta en el propio fichero
  "tx.syncLog", // recibe el `tx` del llamador y registra dentro
];

function ficheros(dir: string): string[] {
  const base = resolve(RAIZ, dir);
  const salida: string[] = [];
  const recorrer = (actual: string) => {
    for (const entrada of readdirSync(actual)) {
      const ruta = resolve(actual, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (entrada.endsWith(".ts") && !entrada.includes(".test.")) salida.push(ruta);
    }
  };
  recorrer(base);
  return salida;
}

const emisores = DIRECTORIOS.flatMap(ficheros)
  .map((ruta) => ({ ruta, fuente: readFileSync(ruta, "utf8") }))
  .filter(
    ({ fuente }) =>
      fuente.includes("syncLogRepository.register") ||
      fuente.includes("syncLog.create"),
  );

describe("todo el que registra un evento lo hace en transacción", () => {
  it("hay emisores que barrer (si no, esta prueba no comprueba nada)", () => {
    // Un barrido sobre cero elementos es verde y no demuestra nada. Al escribirla
    // había 34 ficheros que registran eventos.
    expect(emisores.length).toBeGreaterThanOrEqual(30);
  });

  for (const { ruta, fuente } of emisores) {
    const nombre = ruta.slice(ruta.indexOf("src")).replace(/\\/g, "/");
    it(`${nombre} escribe la fila y el evento juntos`, () => {
      const marca = MARCAS.find((m) => fuente.includes(m));
      expect({ nombre, dentroDeTransaccion: Boolean(marca) }).toEqual({
        nombre,
        dentroDeTransaccion: true,
      });
    });
  }
});

/**
 * El repositorio de `sync_log` acepta un `tx` como segundo argumento. Registrar
 * sin pasarlo, estando dentro de una transacción, es el error silencioso que
 * este barrido no puede ver por sí solo: el fichero tendría su marca y el evento
 * se escribiría igualmente fuera.
 */
describe("los que registran dentro de una transacción le pasan el tx", () => {
  const conRegistro = emisores.filter(({ fuente }) =>
    fuente.includes("syncLogRepository.register({"),
  );

  for (const { ruta, fuente } of conRegistro) {
    const nombre = ruta.slice(ruta.indexOf("src")).replace(/\\/g, "/");
    it(`${nombre} cierra cada register con el tx`, () => {
      const registros = (fuente.match(/syncLogRepository\.register\(\{/g) ?? []).length;
      const conTx = (fuente.match(/\}, tx\);/g) ?? []).length;

      expect({ nombre, registros, conTx }).toEqual({ nombre, registros, conTx: registros });
    });
  }
});
