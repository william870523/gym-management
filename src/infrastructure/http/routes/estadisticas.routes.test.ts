import { describe, expect, it } from "bun:test";
import { app } from "../server";

describe("rutas remotas de estadísticas", () => {
  for (const path of [
    "/estadisticas/rankings",
    "/estadisticas/ranking/entrenadores",
    "/estadisticas/ranking/entrenadores/csv",
    "/estadisticas/socio/ci-prueba",
    "/estadisticas/entrenador/entrenador-prueba",
    "/estadisticas/plan/plan-prueba",
    // E3-b (docs/PLAN_ESTADISTICAS.md §4.3, §5.2 y §5.3).
    "/estadisticas/cohortes",
    "/estadisticas/demanda",
    "/estadisticas/calidad",
    // E4: solo administración después del guardián de autenticación.
    "/estadisticas/contabilidad",
    // E5: pronóstico explicable, también solo administración.
    "/estadisticas/pronostico",
  ]) {
    it(`cierra ${path} detrás de autenticación`, async () => {
      const response = await app.request(path);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Unauthorized - Token required",
      });
    });
  }

  // El 401 de arriba lo devuelve el guardián del prefijo, así que por sí solo
  // NO prueba que la ruta exista: una URL inventada bajo `/estadisticas`
  // responde exactamente igual. Se deja escrito para que nadie vuelva a leerlo
  // como prueba de montaje.
  it("una URL inventada responde igual: el 401 no prueba que la ruta exista", async () => {
    const response = await app.request("/estadisticas/no-existe-esta-ruta");
    expect(response.status).toBe(401);
  });

  // Lo que sí lo prueba es el registro en el router. Sin esta comprobación, una
  // ruta que se olvidara de montar pasaría la de arriba sin que nadie se
  // enterara, y la web se encontraría el 404 en producción —que es exactamente
  // lo que pasó antes de que existiera R6 remoto—.
  it("las rutas están registradas en el router, no solo protegidas", () => {
    const registradas = new Set(
      ((app as unknown as { routes?: Array<{ method: string; path: string }> })
        .routes ?? [])
        .filter((ruta) => ruta.method === "GET" || ruta.method === "ALL")
        .map((ruta) => ruta.path),
    );
    // El router guarda el patrón, no la URL concreta.
    for (const patron of [
      "/estadisticas/rankings",
      "/estadisticas/ranking/:tipo",
      "/estadisticas/ranking/:tipo/csv",
      "/estadisticas/socio/:ci",
      "/estadisticas/entrenador/:id",
      "/estadisticas/plan/:id",
      "/estadisticas/cohortes",
      "/estadisticas/demanda",
      "/estadisticas/calidad",
      "/estadisticas/contabilidad",
      "/estadisticas/pronostico",
    ]) {
      expect(registradas.has(patron)).toBe(true);
    }
    expect(registradas.has("/estadisticas/no-existe-esta-ruta")).toBe(false);
  });
});
