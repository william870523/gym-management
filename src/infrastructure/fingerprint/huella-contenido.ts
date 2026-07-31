import { createHash } from "crypto";

/**
 * Normalización de valores para comparar CONTENIDO entre SQLite y MariaDB.
 *
 * Por qué existe (31-07-2026): la huella de bases comparaba conteos y claves
 * primarias, así que dijo «61 tablas idénticas» mientras 104 socios estaban sin
 * fecha de nacimiento y 23 socios VIEJO figuraban como NUEVO en el remoto.
 * Demostraba que estaban las mismas filas, no que dijeran lo mismo.
 *
 * El problema de comparar contenido entre dos motores es que **el mismo dato se
 * representa distinto**: SQLite guarda las fechas como entero epoch en
 * milisegundos y MariaDB como `DATETIME(3)`; los booleanos van `BOOLEAN` contra
 * `TINYINT(1)`; los decimales llegan como texto de un lado y como `Decimal` del
 * otro; los flotantes son `REAL` contra `DOUBLE`. Sin normalizar, el informe
 * saldría con todo divergente y sería peor que no tenerlo.
 *
 * Este módulo es **gemelo exacto** del de `gym-remote-api`. Su prueba fija las
 * equivalencias con pares (valor de SQLite, valor de MariaDB) que tienen que
 * producir la misma huella.
 */

export type TipoColumna =
  | "fecha"
  | "booleano"
  | "numero"
  | "binario"
  | "texto";

export interface ColumnaHuella {
  nombre: string;
  tipo: TipoColumna;
}

/**
 * Lo único que se excluye de la comparación, y por una razón concreta: el
 * remoto sella `updated_at` con su propio reloj al aplicar cada evento de
 * sincronización, así que diverge por diseño y no por avería.
 *
 * La lista se imprime en el informe. Excluir de más es la manera de volver a
 * quedarse ciego.
 */
export const COLUMNAS_EXCLUIDAS: readonly string[] = ["updated_at"];

/**
 * Columnas que se comparan por **presencia**, no por instante.
 *
 * `deleted_at` es la marca de la baja, y el remoto la sella con su propio reloj
 * al aplicar el evento: comparar el milisegundo marcaría divergente cada fila
 * anulada para siempre, y un informe que nunca llega a cero es un informe que
 * se deja de leer. Lo que sí importa —borrada aquí y viva allá— se conserva:
 * null contra no-null sigue saliendo distinto.
 */
export const COLUMNAS_POR_PRESENCIA: readonly string[] = ["deleted_at"];

const NULO = "∅";
const PRESENTE = "presente";

/**
 * Separadores fuera del alfabeto de los datos: sin ellos, una fila con
 * `a = "1"`, `b = ""` y otra con `a = "1"`, `b = ""` distinta en el corte de
 * campos producirían la misma cadena.
 */
const SEP_CAMPO = "";
const SEP_VALOR = "";

/**
 * Clasifica una columna por el nombre de tipo que declara su propio motor.
 * Acepta las dos gramáticas: `DATETIME` / `DATETIME(3)`, `BOOLEAN` /
 * `TINYINT(1)`, `TEXT` / `VARCHAR(191)`, `BLOB` / `LONGBLOB`.
 */
export function clasificarColumna(tipoDeclarado: string): TipoColumna {
  const tipo = tipoDeclarado.trim().toUpperCase();
  if (
    tipo.startsWith("DATETIME") ||
    tipo.startsWith("TIMESTAMP") ||
    tipo === "DATE"
  ) {
    return "fecha";
  }
  if (tipo.startsWith("BOOL") || tipo.startsWith("TINYINT(1)")) {
    return "booleano";
  }
  if (
    tipo.includes("BLOB") ||
    tipo.startsWith("BINARY") ||
    tipo.startsWith("VARBINARY")
  ) {
    return "binario";
  }
  if (
    tipo.startsWith("INT") ||
    tipo.startsWith("BIGINT") ||
    tipo.startsWith("SMALLINT") ||
    tipo.startsWith("MEDIUMINT") ||
    tipo.startsWith("TINYINT") ||
    tipo.startsWith("REAL") ||
    tipo.startsWith("DOUBLE") ||
    tipo.startsWith("FLOAT") ||
    tipo.startsWith("NUMERIC") ||
    tipo.startsWith("DECIMAL")
  ) {
    return "numero";
  }
  return "texto";
}

function normalizarFecha(valor: unknown): string {
  if (valor instanceof Date) return String(valor.getTime());
  if (typeof valor === "bigint") return String(Number(valor));
  if (typeof valor === "number") return String(valor);
  const instante = new Date(String(valor)).getTime();
  return Number.isNaN(instante) ? `crudo:${String(valor)}` : String(instante);
}

function normalizarBooleano(valor: unknown): string {
  if (typeof valor === "boolean") return valor ? "1" : "0";
  if (typeof valor === "string") {
    const texto = valor.trim().toLowerCase();
    if (texto === "true" || texto === "1") return "1";
    if (texto === "false" || texto === "0" || texto === "") return "0";
  }
  return Number(valor) !== 0 ? "1" : "0";
}

/**
 * Seis decimales absorben el ruido entre `REAL` y `DOUBLE` sin tapar
 * diferencias de dinero, que nunca pasa de dos.
 */
function normalizarNumero(valor: unknown): string {
  const crudo = typeof valor === "object" && valor !== null
    ? String(valor)
    : valor;
  const numero = Number(crudo);
  if (!Number.isFinite(numero)) return `crudo:${String(valor)}`;
  const redondeado = Math.round(numero * 1e6) / 1e6;
  return Object.is(redondeado, -0) ? "0" : String(redondeado);
}

function normalizarBinario(valor: unknown): string {
  const bytes = Buffer.isBuffer(valor)
    ? valor
    : valor instanceof Uint8Array
    ? Buffer.from(valor)
    : Buffer.from(String(valor), "utf8");
  return createHash("sha1").update(bytes).digest("hex");
}

export function normalizarValor(
  valor: unknown,
  tipo: TipoColumna,
  nombre?: string,
): string {
  if (valor === null || valor === undefined) return NULO;
  if (nombre !== undefined && COLUMNAS_POR_PRESENCIA.includes(nombre)) {
    return PRESENTE;
  }
  switch (tipo) {
    case "fecha":
      return normalizarFecha(valor);
    case "booleano":
      return normalizarBooleano(valor);
    case "numero":
      return normalizarNumero(valor);
    case "binario":
      return normalizarBinario(valor);
    case "texto":
      return String(valor);
  }
}

/** 16 hexadecimales bastan: con 20.000 filas la colisión es despreciable. */
function resumir(texto: string): string {
  return createHash("sha1").update(texto, "utf8").digest("hex").slice(0, 16);
}

/**
 * Columnas comparables de una tabla: se ordenan por nombre para que el orden
 * físico de las columnas, que sí difiere entre motores, no cambie la huella.
 */
export function columnasComparables(
  columnas: ColumnaHuella[],
): ColumnaHuella[] {
  return columnas
    .filter((columna) => !COLUMNAS_EXCLUIDAS.includes(columna.nombre))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Huella de una fila sobre las columnas comparables, ya ordenadas. */
export function huellaFila(
  fila: Record<string, unknown>,
  columnas: ColumnaHuella[],
): string {
  const partes = columnas.map(
    (columna) =>
      columna.nombre +
      SEP_VALOR +
      normalizarValor(fila[columna.nombre], columna.tipo, columna.nombre),
  );
  return resumir(partes.join(SEP_CAMPO));
}

/**
 * Huella de una columna sobre todas las filas, en el orden en que se le pasen
 * (siempre por clave primaria).
 *
 * Solo tiene sentido comparar dos huellas de columna cuando los dos lados
 * tienen exactamente las mismas filas: si falta una, la columna entera sale
 * distinta aunque los valores compartidos coincidan. El comparador lo comprueba
 * antes de usarla.
 */
export function huellaColumna(valores: string[]): string {
  return resumir(valores.join(SEP_CAMPO));
}
