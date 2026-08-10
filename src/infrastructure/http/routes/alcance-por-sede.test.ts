/**
 * Unidad 10 · cross-tenant en las rutas que consultan roles.
 *
 * El ADR-roles-multitenant (opción A) quitó `gym_id` de los roles. La objeción
 * evidente es: «entonces, ¿qué aísla?». La respuesta es que el aislamiento
 * nunca lo dio el rol —un rol no es un dato de nadie—, lo da la sede efectiva
 * que el servidor resuelve del token y aplica a cada consulta.
 *
 * Esta prueba fija esa respuesta en las cuatro rutas remotas que el manual
 * nombra. Es estática a propósito: lo que hay que impedir no es un fallo de
 * ejecución, sino que alguien escriba `gymId: body.gym_id` en una ruta nueva y
 * nadie lo note, porque con un solo gimnasio en la base de pruebas eso pasa
 * verde.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const RUTAS: string[] = [
    "configuracion.routes.ts",
    "retention.routes.ts",
    "membership-request.routes.ts",
    "accounting.routes.ts",
];

/** El archivo sin comentarios: las explicaciones citan patrones prohibidos. */
function codigoDe(archivo: string): string {
    return readFileSync(resolve(import.meta.dir, archivo), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
}

describe("alcance por sede en las rutas que consultan roles", () => {
    for (const archivo of RUTAS) test(`${archivo} toma la sede del token, no de la petición`, () => {
        const codigo = codigoDe(archivo);

        // Nadie pasa como ámbito una sede que venga en el cuerpo, la query o la
        // ruta. Con esto, pedir datos de otra sede no es que esté prohibido:
        // es que no hay por dónde pedirlo.
        const desdeLaPeticion =
            /gym_?[Ii]d\s*:\s*(body|payload|input)\b/.test(codigo) ||
            /gym_?[Ii]d\s*:\s*c\.req\.(query|param)\s*\(/.test(codigo);
        expect(desdeLaPeticion).toBe(false);

        // Guarda contra el vacío: si un archivo dejara de usar `auth.gymId`, la
        // aserción de arriba pasaría sin comprobar nada real.
        const desdeElToken = [...codigo.matchAll(/auth[.?]*\.gymId/g)].length;
        expect(desdeElToken).toBeGreaterThan(0);
    });

    test("una sede pedida en el cuerpo solo sirve para rechazar", () => {
        // Contabilidad sí lee `body.gym_id`, y está bien: lo compara con la
        // sede del token y responde 404 si no coinciden. 404 y no 403, para no
        // confirmar que esa otra sede existe.
        const codigo = codigoDe("accounting.routes.ts");
        const comparaciones = [...codigo.matchAll(
            /body\.gym_id\s*&&\s*body\.gym_id\s*!==\s*auth\.gymId/g,
        )].length;
        expect(comparaciones).toBeGreaterThan(0);

        // Y en ningún sitio se usa para otra cosa que compararla.
        const usos = [...codigo.matchAll(/body\.gym_id/g)].length;
        expect(usos).toBe(comparaciones * 2);
    });

    test("los roles ya no son una dimensión de sede", () => {
        // El contrapeso del ADR: si alguien devolviera a filtrar roles por
        // sede, volvería la contradicción de tener dos fuentes de aislamiento.
        for (const archivo of RUTAS) {
            const codigo = codigoDe(archivo);
            expect(/role\.findMany[\s\S]{0,200}?gym_id/.test(codigo)).toBe(false);
            expect(/permission\.findMany[\s\S]{0,200}?gym_id/.test(codigo)).toBe(false);
        }
    });
});
