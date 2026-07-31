/**
 * El parser de CI se valida contra la tabla de vectores compartida, la misma
 * que ejecutan el gemelo de `gym-local-api` y el parser Dart de `gym_client`.
 * Si un vector falla, la implementación está mal: los vectores son el contrato.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { analizarCubaCi, sexoDesdeDigito10 } from "./cuba-ci";

interface Vector {
    ci: string;
    descripcion: string;
    valido: boolean;
    incompleto?: boolean;
    fechaNacimiento: string | null;
    siglo: string | null;
    edad: number | null;
    sexo: string | null;
    errores: string[];
}

const tabla = JSON.parse(
    readFileSync(
        resolve(__dirname, "../../../../shared/cuba-ci/vectors.json"),
        "utf8",
    ),
) as {
    fechaReferencia: string;
    edadMaxima: number;
    vectores: Vector[];
};

const fechaReferencia = new Date(`${tabla.fechaReferencia}T00:00:00.000Z`);

function diaIso(fecha: Date | null): string | null {
    return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

describe("análisis del CI cubano — vectores compartidos", () => {
    it("la tabla de vectores se carga y no está vacía", () => {
        expect(tabla.vectores.length).toBeGreaterThan(0);
    });

    for (const vector of tabla.vectores) {
        it(`${vector.ci} — ${vector.descripcion}`, () => {
            const analisis = analizarCubaCi(vector.ci, {
                fechaReferencia,
                edadMaxima: tabla.edadMaxima,
            });

            expect(analisis.estado === "valido").toBe(vector.valido);
            if (vector.incompleto === true) {
                expect(analisis.estado).toBe("incompleto");
            }
            expect(diaIso(analisis.fechaNacimiento)).toBe(vector.fechaNacimiento);
            expect(analisis.siglo).toBe(vector.siglo);
            expect(analisis.edad).toBe(vector.edad);
            expect(analisis.sexoCodificado).toBe(
                vector.sexo as "masculino" | "femenino" | null,
            );
            expect(
                analisis.errores.map((error) => String(error.codigo)).sort(),
            ).toEqual([...vector.errores].sort());
        });
    }
});

describe("sexo codificado en el dígito 10", () => {
    it("par es masculino e impar es femenino", () => {
        expect(sexoDesdeDigito10("0")).toBe("masculino");
        expect(sexoDesdeDigito10("4")).toBe("masculino");
        expect(sexoDesdeDigito10("3")).toBe("femenino");
        expect(sexoDesdeDigito10("9")).toBe("femenino");
    });

    it("un carácter que no es dígito no codifica sexo", () => {
        expect(sexoDesdeDigito10("A")).toBeNull();
        expect(sexoDesdeDigito10("")).toBeNull();
    });
});

describe("contrato de tiempo", () => {
    it("sin fecha de referencia no inventa una edad", () => {
        const analisis = analizarCubaCi("85042012345");
        expect(analisis.fechaNacimiento).not.toBeNull();
        expect(analisis.edad).toBeNull();
        expect(analisis.estado).toBe("valido");
    });
});
