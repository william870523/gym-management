import { describe, expect, it } from "bun:test";
import { PrismaSyncLogRepository } from "./PrismaSyncLogRepository";

/**
 * Lo que esta prueba protege es el **aislamiento entre sedes**: una instalación
 * solo descarga lo suyo, más una lista corta y explícita de eventos globales.
 *
 * Esa lista creció con multi-sede M1 (docs/MULTI_SEDE.md §3):
 *
 * - `gym`: la edición de una sede ya se emitía como global, pero ninguna
 *   instalación la descargaba. Sin esto, una sede creada en la web no llegaría
 *   nunca a los escritorios.
 * - `user`: solo cuando se emite a propósito con `gym_id: null`, que hoy es el
 *   **Dueño de la cadena**. Exige que la persona tenga el mismo `user_id` en
 *   las dos bases; si no, el correo único hace chocar el evento y bloquea la
 *   cola (`repair:user-identity` alinea identidades).
 *
 * Lo que no puede cambiar: nada de dinero, clientes o planes viaja por la vía
 * global.
 */
describe("aislamiento de descarga remota", () => {
  it("comparte solo la lista explícita de eventos globales", async () => {
    let query: any = null;
    const repository = new PrismaSyncLogRepository({
      async findMany(args: any) {
        query = args;
        return [];
      },
    });
    await repository.findChanges({ afterId: 10 }, 20, "gym-auth");
    expect(query.where.OR).toEqual([
      { gym_id: "gym-auth" },
      {
        gym_id: null,
        entidad: {
          in: [
            "gym",
            "user",
            "moneda",
            "monedas",
            "nacionalidad",
            "nacionalidades",
            "tipo_pago",
            "tipo_cambio",
            "referencia",
          ],
        },
      },
    ]);
  });

  it("nunca comparte entidades de sede por la vía global", async () => {
    let query: any = null;
    const repository = new PrismaSyncLogRepository({
      async findMany(args: any) {
        query = args;
        return [];
      },
    });
    await repository.findChanges({ afterId: 10 }, 20, "gym-auth");
    const global = JSON.stringify(query.where.OR);
    for (const entidad of [
      "planes_pago",
      "cliente",
      "pago_cliente",
      "detalle_pago",
      "tesoreria_movimiento",
      "membresia_cliente",
      "asistencia",
      "cuenta",
    ]) {
      expect(global).not.toContain(entidad);
    }
    // El ámbito por sede sigue siendo la primera condición de la consulta.
    expect(query.where.OR[0]).toEqual({ gym_id: "gym-auth" });
  });
});
