import { describe, expect, it } from "bun:test";
import { ultimaNoticiaDeLaSede } from "./noticia-de-la-sede";

/**
 * §5.2, segundo eje — cuándo se supo por última vez de una sede.
 *
 * Se mira **la más reciente de cinco marcas** y no una sola, y ese es el
 * detalle que importa: `last_upload_at` se queda parada en una sede tranquila
 * —la subida ni se llama cuando no hay eventos— y usarla sola convertiría a una
 * sede al habla en una sede muda. Sobre esa medida se decide si se advierte al
 * mostrador, así que un falso silencio aquí se convierte en un aviso que no
 * toca, y los avisos que no tocan se aprenden a ignorar.
 */
const lector = (dispositivos: any[], estados: any[]) => ({
  device: { findMany: async () => dispositivos },
  syncClientState: { findMany: async () => estados },
});

const D = (iso: string) => new Date(iso);

describe("ultimaNoticiaDeLaSede", () => {
  it("se queda con la marca más reciente de todas", async () => {
    const r = await ultimaNoticiaDeLaSede(
      lector(
        [{ device_id: "d1", last_login_at: D("2026-08-10T09:00:00Z"), last_seen_at: null }],
        [{
          device_id: "d1",
          last_upload_at: D("2026-08-11T10:00:00Z"),
          last_server_sync_at: D("2026-08-20T08:00:00Z"),
          last_seen_at: null,
        }],
      ) as never,
      "gym-a",
    );
    expect(r!.toISOString()).toBe("2026-08-20T08:00:00.000Z");
  });

  it("una sede tranquila que sigue bajando no parece muda", async () => {
    // El caso concreto: sin altas ni cobros no sube nada, así que
    // `last_upload_at` se queda vieja mientras la bajada ocurre cada ciclo.
    const r = await ultimaNoticiaDeLaSede(
      lector(
        [{ device_id: "d1", last_login_at: null, last_seen_at: null }],
        [{
          device_id: "d1",
          last_upload_at: D("2026-07-01T10:00:00Z"),
          last_server_sync_at: D("2026-08-20T11:00:00Z"),
          last_seen_at: null,
        }],
      ) as never,
      "gym-a",
    );
    expect(r!.toISOString()).toBe("2026-08-20T11:00:00.000Z");
  });

  it("mira todos los dispositivos de la sede, no el primero", async () => {
    const r = await ultimaNoticiaDeLaSede(
      lector(
        [
          { device_id: "viejo", last_login_at: D("2026-06-01T10:00:00Z"), last_seen_at: null },
          { device_id: "nuevo", last_login_at: D("2026-08-19T10:00:00Z"), last_seen_at: null },
        ],
        [],
      ) as never,
      "gym-a",
    );
    expect(r!.toISOString()).toBe("2026-08-19T10:00:00.000Z");
  });

  it("sin dispositivos no consta, y no consta no es cero", async () => {
    // Una sede recién dada de alta no ha dado noticias nunca. Devolver una
    // fecha inventada aquí la haría parecer al día.
    expect(await ultimaNoticiaDeLaSede(lector([], []) as never, "gym-a")).toBeNull();
  });

  it("sin sede que preguntar no se consulta nada", async () => {
    let consultado = false;
    const espia = {
      device: {
        findMany: async () => {
          consultado = true;
          return [];
        },
      },
      syncClientState: { findMany: async () => [] },
    };
    expect(await ultimaNoticiaDeLaSede(espia as never, "  ")).toBeNull();
    expect(consultado).toBeFalse();
  });
});
