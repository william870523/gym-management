import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * M4b — el margen NO se tocó, y esta prueba es la razón por la que se puede
 * decir eso sin cruzar los dedos.
 *
 * El margen se construye sobre el **ingreso devengado**, que sale de
 * `pago_cliente` filtrado por `gym_id`. Y `gym_id` es, por contrato de M4b, la
 * sede **dueña del ingreso**, no la que cobró: la sede que cobra queda
 * registrada aparte. De ahí que el margen atribuya bien por construcción, sin
 * saber nada del cobro cruzado.
 *
 * Lo que sí puede pasar —y es lo que esto vigila— es que alguien «arregle» el
 * lector para que mire por dónde entró el dinero. Sería exactamente el
 * «ingreso mal atribuido» que docs/MULTI_SEDE.md §7.10 llama el riesgo
 * contable más caro, y no fallaría ninguna prueba de las que había: el total
 * seguiría cuadrando, solo que en la sede equivocada.
 */
const fuente = (ruta: string) =>
  readFileSync(resolve(import.meta.dir, ruta), "utf8");

describe("M4b · el ingreso se atribuye a la sede dueña, no a la que cobró", () => {
  test("el lector de ingreso devengado filtra los pagos por su gym_id", () => {
    const codigo = fuente("./prisma-membership-revenue.reader.ts");
    expect(codigo).toContain("gym_id: gymId");
    // Si esto deja de ser cierto, el margen de la sede que cobró se infla y el
    // de la sede dueña se queda corto, sin que nada más se queje.
    expect(codigo).not.toContain("cobrado_en_gym_id");
  });

  test("el margen no mira los movimientos de caja, y por eso no le llega lo ajeno", () => {
    // El efectivo cobrado por cuenta ajena vive en `tesoreria_movimiento`. Si
    // el margen empezara a leer de ahí, entraría dinero que la sede no ganó.
    const codigo = fuente("./prisma-management-margin.reader.ts");
    expect(codigo).not.toContain("tesoreriaMovimiento");
  });
});
