import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * R5.4 · Unidad 08 — el servicio remoto de cambio de entrenador es un **gemelo**
 * del local, no una segunda implementación.
 *
 * El manual de la unidad lo dice como condición de parada: «Local y remoto
 * reparten importes distintos» y «Se duplica la lógica de reparto en vez de
 * reutilizar la de offboarding». Esta prueba vigila las dos cosas sin necesidad
 * de base de datos, que es lo que la hace barata de ejecutar siempre.
 *
 * Lo que NO comprueba: los importes concretos de un cambio real. Eso exige
 * datos y vive en las pruebas de ruta y en la verificación de la fixture.
 */
const LOCAL = resolve(
  import.meta.dir,
  "../../../../gym-local-api/src/application/membership/trainer-change.service.ts",
);
const REMOTO = resolve(import.meta.dir, "./trainer-change.service.ts");
const POLITICA_LOCAL = resolve(
  import.meta.dir,
  "../../../../gym-local-api/src/domain/trainer-offboarding-policy.ts",
);
const POLITICA_REMOTA = resolve(
  import.meta.dir,
  "../../domain/trainer-offboarding-policy.ts",
);

const local = readFileSync(LOCAL, "utf8");
const remoto = readFileSync(REMOTO, "utf8");

describe("cambio de entrenador · paridad local/remoto", () => {
  test("la política de reparto es exactamente el mismo archivo", () => {
    // Si estas dos dejan de ser idénticas, el reparto puede divergir sin que
    // ninguna prueba de negocio lo note hasta que un entrenador cobre de menos.
    expect(readFileSync(POLITICA_REMOTA, "utf8")).toBe(
      readFileSync(POLITICA_LOCAL, "utf8"),
    );
  });

  test("ninguno de los dos reimplementa el reparto", () => {
    for (const [nombre, fuente] of [["local", local], ["remoto", remoto]] as const) {
      expect(fuente).toContain("splitCommissionInstallmentAtDate");
      // Una segunda fórmula se reconoce por hacer la regla de tres a mano.
      expect(
        /periodo_fin\.getTime\(\)\s*-\s*periodo_inicio\.getTime\(\)/.test(fuente),
        `${nombre} parece calcular el prorrateo por su cuenta`,
      ).toBe(false);
    }
  });

  test("los mensajes de error y sus códigos coinciden", () => {
    const contrato = (fuente: string) =>
      [...fuente.matchAll(/new TrainerChangeError\(\s*("(?:[^"\\]|\\.)*"|`[^`]*`)\s*(?:,\s*(\d+))?/g)]
        .map((m) => `${m[1]!.replace(/\s+/g, " ")} → ${m[2] ?? "400"}`)
        .sort();

    // Dos listas vacías también serían «iguales». Se exige que la extracción
    // encuentre de verdad los cinco errores del contrato, o la prueba pasaría
    // en vacío el día que alguien renombre `TrainerChangeError`.
    expect(contrato(local).length).toBeGreaterThanOrEqual(5);
    expect(contrato(remoto)).toEqual(contrato(local));
  });

  test("el aviso nace en la misma transacción que el cambio", () => {
    for (const fuente of [local, remoto]) {
      // El servicio recibe la transacción y escribe SIEMPRE sobre ella: si
      // alguna escritura usara el cliente suelto, el aviso podría sobrevivir a
      // un cambio revertido.
      expect(fuente).toContain("avisoAdministracion.create");
      expect(fuente).toMatch(/tx\.avisoAdministracion\.create/);
    }
  });

  test("el remoto acota por el gimnasio del token en toda consulta", () => {
    // El local usa `env.GYM_ID` porque atiende una sola sede; el remoto tiene
    // que usar el gimnasio autenticado y no puede quedarse ninguna consulta sin
    // acotar, o una sede vería datos de otra.
    expect(remoto).not.toContain("env.GYM_ID");
    const consultas = [...remoto.matchAll(/tx\.(\w+)\.(findFirst|findMany)\(\{([\s\S]*?)\n\s*\}\)/g)];
    // Igual que arriba: si el patrón deja de encontrar consultas, esta prueba
    // se volvería un adorno que siempre pasa.
    expect(consultas.length).toBeGreaterThanOrEqual(5);
    const sinAcotar = consultas
      .filter(([, modelo, , cuerpo]) =>
        modelo !== "gym" && !cuerpo!.includes("gym_id") && !cuerpo!.includes("devengo_id"))
      .map(([, modelo]) => modelo);

    expect(sinAcotar).toEqual([]);
  });

  test("el remoto revalida al ejecutor contra la base (R5.6)", () => {
    expect(remoto).toContain("resolveRemotePaymentActor");
    // Y no se fía de un nombre llegado por el cuerpo, como sí puede el local.
    expect(remoto).not.toContain("operatorName");
  });
});
