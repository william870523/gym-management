import { describe, expect, it } from "bun:test";
import { normalizarFecha, resolverFechaNacimiento } from "./client-birthdate";

const FECHA_NEGOCIO = new Date("2026-07-27T00:00:00.000Z");

function iso(fecha: Date | null): string | null {
    return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

describe("carné cubano: la deriva el servidor", () => {
    it("la calcula del CI e IGNORA lo que venga en el cuerpo", () => {
        const resuelta = resolverFechaNacimiento({
            tipoDocumento: "CI_CUBANO",
            ci: "85042012345",
            // Un cliente malicioso o equivocado manda otra cosa: no se usa.
            fechaNacimientoEntrante: "1999-01-01",
            fechaNegocio: FECHA_NEGOCIO,
            esAlta: true,
        });
        expect(iso(resuelta)).toBe("1985-04-20");
    });

    it("rechaza declarar CI_CUBANO con un número que no lo es", () => {
        expect(() =>
            resolverFechaNacimiento({
                tipoDocumento: "CI_CUBANO",
                ci: "AB12345",
                fechaNegocio: FECHA_NEGOCIO,
                esAlta: true,
            }),
        ).toThrow("no es válido");
    });

    it("rechaza un CI con fecha imposible aunque tenga 11 dígitos", () => {
        expect(() =>
            resolverFechaNacimiento({
                tipoDocumento: "CI_CUBANO",
                ci: "85132012345",
                fechaNegocio: FECHA_NEGOCIO,
                esAlta: true,
            }),
        ).toThrow("Mes inválido");
    });
});

describe("pasaporte y otros: se captura", () => {
    it("es obligatoria al dar de alta", () => {
        expect(() =>
            resolverFechaNacimiento({
                tipoDocumento: "PASAPORTE",
                ci: "X1234567",
                fechaNegocio: FECHA_NEGOCIO,
                esAlta: true,
            }),
        ).toThrow("obligatoria");
    });

    it("al editar no se exige, para no bloquear cambios ajenos", () => {
        const resuelta = resolverFechaNacimiento({
            tipoDocumento: "PASAPORTE",
            ci: "X1234567",
            fechaNacimientoActual: new Date("1990-05-05T00:00:00.000Z"),
            fechaNegocio: FECHA_NEGOCIO,
            esAlta: false,
        });
        expect(iso(resuelta)).toBe("1990-05-05");
    });

    it("acepta y normaliza la fecha capturada", () => {
        const resuelta = resolverFechaNacimiento({
            tipoDocumento: "PASAPORTE",
            ci: "X1234567",
            fechaNacimientoEntrante: "1990-05-05",
            fechaNegocio: FECHA_NEGOCIO,
            esAlta: true,
        });
        expect(iso(resuelta)).toBe("1990-05-05");
    });

    it("no admite una fecha futura", () => {
        expect(() =>
            resolverFechaNacimiento({
                tipoDocumento: "PASAPORTE",
                ci: "X1234567",
                fechaNacimientoEntrante: "2030-01-01",
                fechaNegocio: FECHA_NEGOCIO,
                esAlta: true,
            }),
        ).toThrow("futuro");
    });

    it("no admite una edad imposible", () => {
        expect(() =>
            resolverFechaNacimiento({
                tipoDocumento: "PASAPORTE",
                ci: "X1234567",
                fechaNacimientoEntrante: "1880-01-01",
                fechaNegocio: FECHA_NEGOCIO,
                esAlta: true,
            }),
        ).toThrow("máximo admitido");
    });
});

describe("desconocido: opcional, porque el tipo significa que no se sabe", () => {
    it("no se exige ni al dar de alta", () => {
        const resuelta = resolverFechaNacimiento({
            tipoDocumento: "DESCONOCIDO",
            ci: "algo-heredado",
            fechaNegocio: FECHA_NEGOCIO,
            esAlta: true,
        });
        expect(resuelta).toBeNull();
    });

    it("si llega, se valida igual", () => {
        expect(() =>
            resolverFechaNacimiento({
                tipoDocumento: "DESCONOCIDO",
                ci: "algo-heredado",
                fechaNacimientoEntrante: "2030-01-01",
                fechaNegocio: FECHA_NEGOCIO,
                esAlta: true,
            }),
        ).toThrow("futuro");
    });
});

describe("normalización de la fecha entrante", () => {
    it("acepta día suelto y texto ISO completo, y recorta a día UTC", () => {
        expect(iso(normalizarFecha("1985-04-20"))).toBe("1985-04-20");
        expect(iso(normalizarFecha("1985-04-20T18:30:00.000Z"))).toBe("1985-04-20");
        expect(iso(normalizarFecha(new Date("1985-04-20T18:30:00.000Z")))).toBe(
            "1985-04-20",
        );
    });

    it("vacío es ausencia, ilegible es error", () => {
        expect(normalizarFecha(null)).toBeNull();
        expect(normalizarFecha("")).toBeNull();
        expect(normalizarFecha(undefined)).toBeNull();
        expect(() => normalizarFecha("no soy una fecha")).toThrow("no es una fecha");
    });
});
