/**
 * Huella SOLO LECTURA de la base, para comparar MariaDB contra SQLite.
 *
 * Escribe un JSON con, por cada tabla: número de filas, filas no borradas, la
 * lista de claves primarias y —desde el 31-07-2026— la **huella del contenido**:
 * un resumen por fila y otro por columna.
 *
 * Por qué se añadió el contenido: hasta esa fecha la huella comparaba conteos y
 * claves, así que dijo «61 tablas idénticas» mientras 104 socios estaban sin
 * fecha de nacimiento y 23 socios VIEJO figuraban como NUEVO en esta base.
 * Demostraba que estaban las mismas filas, no que dijeran lo mismo.
 *
 * La normalización entre motores vive en un único módulo con sus vectores de
 * prueba (`src/infrastructure/fingerprint/huella-contenido.ts`).
 *
 * No modifica nada. Gemelo: `gym-local-api/scripts/fingerprint-database.ts`.
 *
 * Uso:  bun run fingerprint  [ruta-de-salida]
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  clasificarColumna,
  columnasComparables,
  COLUMNAS_EXCLUIDAS,
  huellaColumna,
  huellaFila,
  normalizarValor,
  type ColumnaHuella,
} from "../src/infrastructure/fingerprint/huella-contenido";

const SALIDA =
  process.argv[2] ?? resolve(__dirname, "../../backups/fingerprint-remote.json");

interface TablaHuella {
  filas: number;
  vivas: number | null;
  pk: string[];
  claves: string[];
  columnas: ColumnaHuella[];
  excluidas: string[];
  /** clave primaria → resumen de la fila. Vacío si la tabla no tiene PK. */
  contenido: Record<string, string>;
  /** columna → resumen de todos sus valores, en orden de clave. */
  huellaColumnas: Record<string, string>;
}

async function tablas(): Promise<string[]> {
  const filas = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    "SELECT TABLE_NAME FROM information_schema.TABLES " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' " +
      "ORDER BY TABLE_NAME",
  );
  return filas.map((fila) => fila.TABLE_NAME);
}

async function columnas(tabla: string) {
  return await prisma.$queryRawUnsafe<
    Array<{ COLUMN_NAME: string; COLUMN_TYPE: string; COLUMN_KEY: string }>
  >(
    "SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    tabla,
  );
}

async function huella() {
  const resultado: Record<string, TablaHuella> = {};

  for (const tabla of await tablas()) {
    const cols = await columnas(tabla);
    const pk = cols
      .filter((col) => col.COLUMN_KEY === "PRI")
      .map((col) => col.COLUMN_NAME);
    const tieneBorrado = cols.some((col) => col.COLUMN_NAME === "is_deleted");

    const [{ n }] = await prisma.$queryRawUnsafe<
      Array<{ n: bigint | number }>
    >(`SELECT COUNT(*) AS n FROM \`${tabla}\``);
    let vivas: number | null = null;
    if (tieneBorrado) {
      const [{ v }] = await prisma.$queryRawUnsafe<
        Array<{ v: bigint | number }>
      >(`SELECT COUNT(*) AS v FROM \`${tabla}\` WHERE is_deleted = 0`);
      vivas = Number(v);
    }

    const comparables = columnasComparables(
      cols.map((col) => ({
        nombre: col.COLUMN_NAME,
        tipo: clasificarColumna(String(col.COLUMN_TYPE ?? "")),
      })),
    );

    let claves: string[] = [];
    const contenido: Record<string, string> = {};
    const huellaColumnas: Record<string, string> = {};

    if (pk.length > 0) {
      const filas = await prisma.$queryRawUnsafe<
        Array<Record<string, unknown>>
      >(`SELECT * FROM \`${tabla}\``);

      const conClave = filas
        .map((fila) => ({
          clave: pk
            .map((col) => (fila[col] === null ? "" : String(fila[col])))
            .join("|"),
          fila,
        }))
        .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));

      claves = conClave.map((entrada) => entrada.clave);
      for (const entrada of conClave) {
        contenido[entrada.clave] = huellaFila(entrada.fila, comparables);
      }
      for (const columna of comparables) {
        huellaColumnas[columna.nombre] = huellaColumna(
          conClave.map((entrada) =>
            normalizarValor(entrada.fila[columna.nombre], columna.tipo, columna.nombre)
          ),
        );
      }
    }

    resultado[tabla] = {
      filas: Number(n),
      vivas,
      pk,
      claves,
      columnas: comparables,
      excluidas: [...COLUMNAS_EXCLUIDAS],
      contenido,
      huellaColumnas,
    };
  }

  writeFileSync(SALIDA, JSON.stringify(resultado), "utf8");
  const totalTablas = Object.keys(resultado).length;
  const totalFilas = Object.values(resultado).reduce(
    (suma, tabla) => suma + tabla.filas,
    0,
  );
  const conContenido = Object.values(resultado).filter(
    (tabla) => Object.keys(tabla.contenido).length > 0,
  ).length;
  console.log(
    `Huella escrita en ${SALIDA} — ${totalTablas} tablas, ${totalFilas} filas, ` +
      `${conContenido} con huella de contenido.`,
  );
}

try {
  await huella();
} finally {
  await prisma.$disconnect();
}
