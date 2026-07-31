import { describe, expect, it } from "bun:test";
import {
  clasificarColumna,
  COLUMNAS_EXCLUIDAS,
  columnasComparables,
  huellaColumna,
  huellaFila,
  normalizarValor,
  type ColumnaHuella,
} from "./huella-contenido";

/**
 * Estos pares son el contrato de la huella de contenido: **a la izquierda lo
 * que devuelve SQLite, a la derecha lo que devuelve MariaDB para el mismo
 * dato**. Si un par deja de coincidir, el informe de paridad empieza a mentir
 * en una de las dos direcciones —o marca divergente lo idéntico, o calla una
 * diferencia real—.
 */
const EQUIVALENCIAS: Array<{
  caso: string;
  tipo: ColumnaHuella["tipo"];
  sqlite: unknown;
  mariadb: unknown;
}> = [
  {
    caso: "fecha: epoch en milisegundos contra DATETIME(3)",
    tipo: "fecha",
    sqlite: 1_753_920_000_000,
    mariadb: new Date(1_753_920_000_000),
  },
  {
    caso: "fecha nula",
    tipo: "fecha",
    sqlite: null,
    mariadb: null,
  },
  {
    caso: "booleano: 1 contra tinyint 1",
    tipo: "booleano",
    sqlite: 1,
    mariadb: true,
  },
  {
    caso: "booleano: 0 contra tinyint 0",
    tipo: "booleano",
    sqlite: false,
    mariadb: 0,
  },
  {
    caso: "decimal: texto contra Decimal",
    tipo: "numero",
    sqlite: "1200.00",
    mariadb: { toString: () => "1200" },
  },
  {
    caso: "decimal con céntimos",
    tipo: "numero",
    sqlite: "48.80",
    mariadb: { toString: () => "48.8000000000" },
  },
  {
    caso: "flotante: REAL contra DOUBLE con ruido de coma flotante",
    tipo: "numero",
    sqlite: 0.1 + 0.2,
    mariadb: 0.3,
  },
  {
    caso: "entero grande: bigint contra number",
    tipo: "numero",
    sqlite: 9_007_199_254_740n,
    mariadb: 9_007_199_254_740,
  },
  {
    caso: "binario: Uint8Array contra Buffer",
    tipo: "binario",
    sqlite: new Uint8Array([1, 2, 3, 4]),
    mariadb: Buffer.from([1, 2, 3, 4]),
  },
  {
    caso: "texto idéntico",
    tipo: "texto",
    sqlite: "Trimestral",
    mariadb: "Trimestral",
  },
];

describe("huella de contenido · equivalencias entre motores", () => {
  for (const par of EQUIVALENCIAS) {
    it(`iguala ${par.caso}`, () => {
      expect(normalizarValor(par.sqlite, par.tipo)).toBe(
        normalizarValor(par.mariadb, par.tipo),
      );
    });
  }

  it("distingue lo que de verdad es distinto", () => {
    expect(normalizarValor("100.00", "numero")).not.toBe(
      normalizarValor("100.01", "numero"),
    );
    expect(normalizarValor(null, "texto")).not.toBe(
      normalizarValor("", "texto"),
    );
    expect(normalizarValor(0, "booleano")).not.toBe(
      normalizarValor(1, "booleano"),
    );
    // El defecto que motivó todo esto: una fecha ausente contra una presente.
    expect(normalizarValor(null, "fecha")).not.toBe(
      normalizarValor(new Date("1991-10-21T00:00:00.000Z"), "fecha"),
    );
  });
});

describe("huella de contenido · clasificación de columnas", () => {
  const casos: Array<[string, string]> = [
    ["DATETIME", "fecha"],
    ["DATETIME(3)", "fecha"],
    ["BOOLEAN", "booleano"],
    ["TINYINT(1)", "booleano"],
    ["INT(11)", "numero"],
    ["INT(10) UNSIGNED", "numero"],
    ["BIGINT(20)", "numero"],
    ["REAL", "numero"],
    ["DOUBLE", "numero"],
    ["DECIMAL(18,2)", "numero"],
    ["BLOB", "binario"],
    ["LONGBLOB", "binario"],
    ["TEXT", "texto"],
    ["VARCHAR(191)", "texto"],
    ["LONGTEXT", "texto"],
  ];
  for (const [declarado, esperado] of casos) {
    it(`clasifica ${declarado} como ${esperado}`, () => {
      expect(clasificarColumna(declarado)).toBe(esperado as any);
    });
  }
});

describe("huella de contenido · filas y columnas", () => {
  const columnas: ColumnaHuella[] = [
    { nombre: "ci", tipo: "texto" },
    { nombre: "fecha_nacimiento", tipo: "fecha" },
    { nombre: "categoria", tipo: "texto" },
    { nombre: "updated_at", tipo: "fecha" },
  ];

  it("ordena por nombre y aparta updated_at", () => {
    const comparables = columnasComparables(columnas);
    expect(comparables.map((columna) => columna.nombre)).toEqual([
      "categoria",
      "ci",
      "fecha_nacimiento",
    ]);
    expect(COLUMNAS_EXCLUIDAS).toEqual(["updated_at"]);
  });

  it("la misma fila en los dos motores produce la misma huella", () => {
    const comparables = columnasComparables(columnas);
    const enSqlite = {
      ci: "91102110037",
      fecha_nacimiento: 688_003_200_000,
      categoria: "VIEJO",
      updated_at: 1_753_920_000_000,
    };
    const enMariadb = {
      ci: "91102110037",
      fecha_nacimiento: new Date(688_003_200_000),
      categoria: "VIEJO",
      // Sellado por el remoto al aplicar el evento: diverge por diseño.
      updated_at: new Date(1_753_999_999_000),
    };
    expect(huellaFila(enSqlite, comparables)).toBe(
      huellaFila(enMariadb, comparables),
    );
  });

  it("delata exactamente el defecto del 31-07-2026", () => {
    const comparables = columnasComparables(columnas);
    const correcta = {
      ci: "91102110037",
      fecha_nacimiento: 688_003_200_000,
      categoria: "VIEJO",
    };
    const perdida = {
      ci: "91102110037",
      fecha_nacimiento: null,
      categoria: "NUEVO",
    };
    expect(huellaFila(correcta, comparables)).not.toBe(
      huellaFila(perdida, comparables),
    );
  });

  it("no confunde el corte entre campos", () => {
    const comparables: ColumnaHuella[] = [
      { nombre: "a", tipo: "texto" },
      { nombre: "b", tipo: "texto" },
    ];
    expect(huellaFila({ a: "1", b: "" }, comparables)).not.toBe(
      huellaFila({ a: "1b", b: "" }, comparables),
    );
  });

  it("compara `deleted_at` por presencia, no por instante", () => {
    // El remoto sella la baja con su propio reloj: comparar el milisegundo
    // marcaría divergente cada fila anulada para siempre.
    expect(normalizarValor(1_753_920_000_000, "fecha", "deleted_at")).toBe(
      normalizarValor(new Date(1_753_999_999_000), "fecha", "deleted_at"),
    );
    // Pero borrada aquí y viva allá sigue siendo una divergencia.
    expect(normalizarValor(1_753_920_000_000, "fecha", "deleted_at")).not.toBe(
      normalizarValor(null, "fecha", "deleted_at"),
    );
    // Y la regla no se contagia a las demás columnas de fecha.
    expect(normalizarValor(1_753_920_000_000, "fecha", "created_at")).not.toBe(
      normalizarValor(new Date(1_753_999_999_000), "fecha", "created_at"),
    );
  });

  it("la huella de columna depende del orden de las filas", () => {
    expect(huellaColumna(["a", "b"])).not.toBe(huellaColumna(["b", "a"]));
    expect(huellaColumna(["a", "b"])).toBe(huellaColumna(["a", "b"]));
  });
});
