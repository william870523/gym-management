import { describe, expect, it } from "bun:test";
import { usuarioSedeId } from "./usuario-sede";

/**
 * Este valor está fijado a propósito y **es el mismo en `gym-local-api`**.
 * Si alguien cambia el algoritmo en una sola base, las dos dejan de calcular el
 * mismo identificador para la misma persona y sede, y la fila que llegue por
 * sincronización chocará con la unicidad `(user_id, gym_id)`.
 */
describe("identificador de usuario↔sede", () => {
    it("es determinista y compartido por las dos bases", () => {
        expect(usuarioSedeId("user-ana", "local-gym-001")).toBe(
            "us-b8846ad0229cb23298a2f415c0ca986b",
        );
    });

    it("no depende de espacios accidentales", () => {
        expect(usuarioSedeId("  user-ana ", " local-gym-001")).toBe(
            usuarioSedeId("user-ana", "local-gym-001"),
        );
    });

    it("distingue sedes y personas", () => {
        expect(usuarioSedeId("user-ana", "gym-a")).not.toBe(
            usuarioSedeId("user-ana", "gym-b"),
        );
        expect(usuarioSedeId("user-ana", "gym-a")).not.toBe(
            usuarioSedeId("user-bruno", "gym-a"),
        );
    });
});
