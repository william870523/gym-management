import { describe, expect, it } from "bun:test";
import { registrarNoticiaDeLaSede } from "./noticia-de-la-sede";

/**
 * M5 — la marca de la que depende `SIN_NOTICIAS`.
 *
 * Lo que se fija aquí es que **bajar cambios también cuenta como noticia**. Sin
 * eso, una sede tranquila —que baja cada ciclo y no tiene nada que subir— no
 * dejaba rastro ninguno y el semáforo la daría por incomunicada estando al
 * habla.
 */
const CUANDO = new Date("2026-08-17T20:00:00.000Z");

function baseFalsa(fallar = false) {
  const escrituras: any[] = [];
  return {
    escrituras,
    cliente: {
      syncClientState: {
        async upsert(args: any) {
          if (fallar) throw new Error("la base dijo que no");
          escrituras.push(args);
          return args;
        },
      },
    },
  };
}

describe("M5 · noticia de la sede", () => {
  it("bajar cambios deja rastro, que es el caso que faltaba", async () => {
    const { cliente, escrituras } = baseFalsa();
    const anotado = await registrarNoticiaDeLaSede(cliente, {
      deviceId: "dev-oeste",
      cuando: CUANDO,
      motivo: "BAJADA",
    });
    expect(anotado).toBeTrue();
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].where).toEqual({ device_id: "dev-oeste" });
    expect(escrituras[0].update).toEqual({
      last_server_sync_at: CUANDO,
      last_seen_at: CUANDO,
    });
    // Bajar no es subir: decir lo contrario haría creer que esa sede mandó
    // eventos que nunca mandó.
    expect(escrituras[0].update.last_upload_at).toBeUndefined();
  });

  it("subir se anota como subida", async () => {
    const { cliente, escrituras } = baseFalsa();
    await registrarNoticiaDeLaSede(cliente, {
      deviceId: "dev-oeste",
      cuando: CUANDO,
      motivo: "SUBIDA",
    });
    expect(escrituras[0].update).toEqual({
      last_upload_at: CUANDO,
      last_seen_at: CUANDO,
    });
  });

  it("sin dispositivo no se escribe una fila fantasma", async () => {
    const { cliente, escrituras } = baseFalsa();
    expect(
      await registrarNoticiaDeLaSede(cliente, { deviceId: "  ", cuando: CUANDO, motivo: "BAJADA" }),
    ).toBeFalse();
    expect(escrituras).toHaveLength(0);
  });

  it("si la base falla, la sincronización sigue", async () => {
    // Es telemetría. Perder la marca es molesto; tumbar la bajada por no poder
    // anotarla dejaría a la sede sin datos, que es incomparablemente peor.
    const { cliente } = baseFalsa(true);
    const fallos: unknown[] = [];
    const anotado = await registrarNoticiaDeLaSede(cliente, {
      deviceId: "dev-oeste",
      cuando: CUANDO,
      motivo: "BAJADA",
      alFallar: (error) => fallos.push(error),
    });
    expect(anotado).toBeFalse();
    expect(fallos).toHaveLength(1);
  });
});
