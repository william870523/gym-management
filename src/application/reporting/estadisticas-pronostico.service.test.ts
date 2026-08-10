import { describe, expect, test } from "bun:test";
import type { EstadisticasPronosticoReader } from "./estadisticas-pronostico.reader";
import {
  ConsultaPronosticoInvalida,
  EstadisticasPronosticoService,
  percentil,
} from "./estadisticas-pronostico.service";

const DIA = 86_400_000;
const hoy = new Date("2026-08-01T00:00:00.000Z");

function filas(dias = 90) {
  return Array.from({ length: dias }, (_, indice) => {
    const fecha = new Date(hoy.getTime() - (dias - indice) * DIA);
    const semana = Math.floor(indice / 7) % 3;
    return {
      dia: fecha.toISOString().slice(0, 10),
      visitas: fecha.getUTCDay() * 10 + semana,
    };
  });
}

function reader(input?: { truncado?: boolean; dias?: number }): EstadisticasPronosticoReader {
  const datos = filas(input?.dias ?? 90);
  return {
    async leerVisitasDiarias() {
      return {
        visitasPorDia: datos,
        primeraEntradaDia: datos[0]?.dia ?? null,
        truncado: input?.truncado ?? false,
      };
    },
  };
}

describe("EstadisticasPronosticoService", () => {
  test("publica mediana y banda empírica por día, sin caja negra", async () => {
    const salida = await new EstadisticasPronosticoService(reader()).pronostico({
      gymId: "gym-a",
      zona: "America/Los_Angeles",
      hoy,
      diasHistoria: 90,
      diasHorizonte: 28,
    });
    expect(salida.disponible).toBe(true);
    expect(salida.proyeccionDiaria).toHaveLength(28);
    expect(salida.proyeccionSemanal).toHaveLength(4);
    expect(salida.totalHorizonte).not.toBeNull();
    expect(salida.metodo.nombre).toContain("Mediana");
    expect(salida.metodo.intervalo).toContain("percentiles 10 y 90");
    expect(salida.metodo.garantia).toContain("No es IA");
    expect(salida.porDiaSemana.every((fila) => fila.muestras >= 12)).toBe(true);
    expect(salida.proyeccionDiaria[0]?.dia).toBe("2026-08-02");
  });

  test("falla cerrado con historia corta o lectura truncada", async () => {
    const corta = await new EstadisticasPronosticoService(reader({ dias: 28 }))
      .pronostico({
        gymId: "gym-a", zona: "Etc/UTC", hoy, diasHistoria: 90, diasHorizonte: 7,
      });
    expect(corta.disponible).toBe(false);
    expect(corta.proyeccionDiaria).toEqual([]);
    const truncada = await new EstadisticasPronosticoService(reader({ truncado: true }))
      .pronostico({
        gymId: "gym-a", zona: "Etc/UTC", hoy, diasHistoria: 90, diasHorizonte: 7,
      });
    expect(truncada.disponible).toBe(false);
    expect(truncada.motivoNoDisponible).toContain("tope");
  });

  test("valida períodos y usa percentil lineal determinista", async () => {
    expect(percentil([0, 10], 0.1)).toBe(1);
    expect(percentil([10, 0], 0.5)).toBe(5);
    await expect(
      new EstadisticasPronosticoService(reader()).pronostico({
        gymId: "gym-a", zona: "Etc/UTC", hoy, diasHistoria: 30, diasHorizonte: 28,
      }),
    ).rejects.toBeInstanceOf(ConsultaPronosticoInvalida);
  });
});

