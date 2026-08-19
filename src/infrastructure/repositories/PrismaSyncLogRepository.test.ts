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
 * Y creció otra vez con M4a (docs/MULTI_SEDE.md §9-bis):
 *
 * - `acceso_multisede_precio`: el precio del plus es catálogo de la cadena.
 * - `cliente_acceso_multisede`: la marca de un socio tiene que llegar a TODAS
 *   las sedes —no solo a la suya— o la sede visitada no sabría que puede
 *   dejarle entrar. Es el marcador de acceso, **no la ficha del socio**: no
 *   lleva datos personales ni financieros, solo a quién se le vendió el plus,
 *   de qué sede es y hasta cuándo cubre.
 *
 * - `cierre_cadena_solicitud` (M5): la petición de cierre que emite
 *   contabilidad central. Una para toda la cadena, y **no lleva dinero**: dice
 *   qué período hay que cerrar y quién lo pidió, nada más. Si a una sede no le
 *   llegara, el semáforo la reclamaría por no cerrar algo que nunca se le pidió.
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
            "acceso_multisede_precio",
            "cierre_cadena_solicitud",
            "cliente_acceso_multisede",
            "cliente_visitante",
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
    // Comparación por nombre EXACTO, no por subcadena. La versión anterior
    // buscaba «cliente» dentro del JSON y habría rechazado
    // `cliente_acceso_multisede`, que es el marcador del plus y no la ficha del
    // socio. Una prueba que confunde dos entidades por parecerse en el nombre
    // acaba prohibiendo lo correcto o —peor— dejando pasar lo que sí importa
    // el día que alguien la relaje para que compile.
    const globales: string[] = query.where.OR[1].entidad.in;
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
      expect(globales).not.toContain(entidad);
    }
    // El ámbito por sede sigue siendo la primera condición de la consulta.
    expect(query.where.OR[0]).toEqual({ gym_id: "gym-auth" });
  });
});
