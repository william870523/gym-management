import { describe, expect, it } from "bun:test";
import { textoOpcionalDeSede } from "./gyms.controller";

/**
 * «Sin país» tiene que escribirse de UNA sola forma en las dos bases: `null`.
 *
 * Lo destapó el recorrido del dueño del 13-08-2026: una sede creada desde el
 * escritorio con el país en «Sin definir» quedó con `pais = ""` en SQLite y
 * `pais = NULL` en MariaDB, porque el receptor remoto normaliza con truthiness
 * y el borde de escritura no. Misma sede, dos contenidos: fallo del gate de
 * paridad, no un detalle de estilo.
 *
 * La prueba es **gemela** de la del local. Si cambia una, cambia la otra.
 */
describe("textoOpcionalDeSede", () => {
    it("guarda null cuando el campo llega en blanco", () => {
        expect(textoOpcionalDeSede("")).toBeNull();
        expect(textoOpcionalDeSede("   ")).toBeNull();
        expect(textoOpcionalDeSede(null)).toBeNull();
    });

    it("distingue «no tocar» de «vaciar»", () => {
        // Campo ausente: la edición no debe moverlo.
        expect(textoOpcionalDeSede(undefined)).toBeUndefined();
        // Campo presente y vacío: se vacía de verdad.
        expect(textoOpcionalDeSede("")).toBeNull();
    });

    it("recorta el texto que sí trae dato", () => {
        expect(textoOpcionalDeSede("  Cuba  ")).toBe("Cuba");
        expect(textoOpcionalDeSede("Cuba")).toBe("Cuba");
    });
});
