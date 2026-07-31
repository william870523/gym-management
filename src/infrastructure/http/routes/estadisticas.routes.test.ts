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
  ]) {
    it(`monta ${path} detrás de autenticación`, async () => {
      const response = await app.request(path);

      // Antes de R6 remoto estas URLs caían en el 404 global. Un 401 demuestra
      // que la ruta existe y que se detuvo en la puerta correcta, sin consultar
      // MariaDB ni revelar si la entidad existe.
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Unauthorized - Token required",
      });
    });
  }
});
