import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CreatePagoClienteSchema } from "../../../application/dtos/PagoClienteDTO";

/**
 * Dos de las tres «divergencias de forma entre gemelos» que la certificación
 * R5-P entregó abiertas, cerradas el 12-08-2026.
 *
 * La nota decía: «el remoto exige `fecha` ISO completa y `moneda_id` donde el
 * local los deriva». Medido contra el código, eran dos cosas distintas y solo
 * una era cosmética:
 *
 * - **`fecha`**: el remoto la exigía y luego la tiraba. El caso de uso sella
 *   `trustedClock.nowUtc()`, y su propio comentario lo dice: «el servidor fija
 *   el instante». Pedirle al cliente un dato que se ignora no es estricto, es
 *   engañoso: invita a creer que su reloj cuenta, justo lo que
 *   `docs/TIME_CONTRACT.md` prohíbe.
 *
 * - **`moneda_id`**: esta sí se usaba, y ese era el problema. La moneda del
 *   cobro salía del cuerpo de la petición. Un cliente que mandara otra dejaba
 *   registrado un cobro cuya moneda no casa con su plan, en un proyecto que
 *   prohíbe sumar monedas distintas. El gemelo local la derivaba desde siempre.
 */
describe("cobro: el servidor manda en la fecha y en la moneda", () => {
  const USO = resolve(
    import.meta.dir,
    "../../../application/use-cases/pago_cliente/ProcessPaymentUseCase.ts",
  );
  const fuenteUso = readFileSync(USO, "utf8");
  const fuenteControlador = readFileSync(
    resolve(import.meta.dir, "./PagoClienteController.ts"),
    "utf8",
  );

  it("la moneda del cobro sale del plan, no del cuerpo", () => {
    expect(fuenteUso).toContain("moneda_id: plan.moneda_id");
    // La forma vieja no puede volver por descuido.
    expect(fuenteUso).not.toContain("moneda_id: input.moneda_id");
  });

  it("la fecha la sella el reloj confiable", () => {
    expect(fuenteUso).toContain("const occurredAt = trustedClock.nowUtc()");
    expect(fuenteUso).toContain("fecha: occurredAt");
  });

  it("el esquema de proceso ya no exige ninguna de las dos", () => {
    // Se comprueba sobre el fichero porque el esquema es privado del módulo.
    const bloque = fuenteControlador.slice(
      fuenteControlador.indexOf("const ProcessPaymentSchema"),
    );
    const hastaCierre = bloque.slice(0, bloque.indexOf("}).superRefine"));

    expect(hastaCierre).toContain("fecha: z.string().datetime().optional()");
    expect(hastaCierre).toContain("moneda_id: z.string().uuid().optional()");
  });

  it("el DTO base sigue describiendo el cobro completo", () => {
    // Relajar el proceso no debe relajar la forma canónica de un pago: el DTO
    // se usa para describir la entidad, no solo para validar una entrada.
    const valido = CreatePagoClienteSchema.safeParse({
      ci: "91021020015",
      fecha: new Date().toISOString(),
      monto_total: 30,
      id_planes_pago: "9e4199de-e214-58b1-89a6-e4ccc261b046",
      moneda_id: "48dd0e12-2349-4efb-9016-470ffa42bd3d",
    });

    expect(valido.success).toBe(true);
  });
});
