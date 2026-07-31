import { describe, expect, it } from "bun:test";
import { EstadisticasEntrenadorService } from "./estadisticas-entrenador.service";
import type { EstadisticasEntrenadorReader } from "./estadisticas-entrenador.reader";

const HOY = new Date("2026-07-30T00:00:00.000Z");

const base: EstadisticasEntrenadorReader = {
    leerEntrenador: async () => ({
        id: "e1",
        nombre: "Dayana Rodríguez",
        sexo: "Femenino",
        activo: true,
        desde: new Date("2026-01-15T00:00:00.000Z"),
    }),
    leerCartera: async () => ({ activos: 21, historicos: 22, cerradas: 1 }),
    leerMovimientos: async () => [
        { mes: "2026-06", altas: 5, bajas: 1 },
        { mes: "2026-07", altas: 3, bajas: 0 },
    ],
    leerMotivosCierre: async () => [
        { etiqueta: "El socio pidió otro horario", total: 1 },
    ],
    leerComposicion: async (_g, _i, dimension) =>
        dimension === "plan"
            ? [
                  { etiqueta: "Mensual con entrenador", total: 12 },
                  { etiqueta: "Semanal", total: 9 },
              ]
            : [
                  { etiqueta: "Masculino", total: 11 },
                  { etiqueta: "Femenino", total: 10 },
              ],
    leerFranjasObservadas: async () => [
        { etiqueta: "Tarde", total: 90 },
        { etiqueta: "Mañana", total: 70 },
    ],
    leerSociosPorVisitas: async () => [
        { ci: "a", nombre: "Luis", visitas: 100 },
        { ci: "b", nombre: "Rosa", visitas: 60 },
    ],
    leerRenovacion: async () => ({ renovaciones: 84, terminadas: 91 }),
    leerIngresos: async () => [
        { moneda_id: "cup", cobros: 61, total: 112735 },
        { moneda_id: "eur", cobros: 5, total: 125 },
    ],
};

describe("perfil del entrenador", () => {
    it("responde «cuántos ha ganado y cuántos ha perdido»", async () => {
        const perfil = (await new EstadisticasEntrenadorService(base).perfil({
            gymId: "g1",
            entrenadorId: "e1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.cartera.activos).toBe(21);
        expect(perfil.cartera.historicos).toBe(22);
        expect(perfil.cartera.perdidos).toBe(1);
        expect(perfil.cartera.movimientos).toHaveLength(2);
        expect(perfil.cartera.motivosDeCierre[0]!.motivo).toContain("horario");
    });

    it("una cartera no puede tener más activos que históricos", async () => {
        const perfil = (await new EstadisticasEntrenadorService(base).perfil({
            gymId: "g1",
            entrenadorId: "e1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.cartera.activos).toBeLessThanOrEqual(
            perfil.cartera.historicos,
        );
    });

    it("la retención lleva su denominador y no se infla", async () => {
        const perfil = (await new EstadisticasEntrenadorService(base).perfil({
            gymId: "g1",
            entrenadorId: "e1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        // 84 renovaciones sobre 91 oportunidades terminadas.
        expect(perfil.retencion.casos).toBe(84);
        expect(perfil.retencion.base).toBe(91);
        expect(perfil.retencion.porcentaje).toBe(92.3);
    });

    it("sin contratos terminados no inventa un 100 % de retención", async () => {
        const sinHistoria: EstadisticasEntrenadorReader = {
            ...base,
            leerRenovacion: async () => ({ renovaciones: 0, terminadas: 0 }),
        };
        const perfil = (await new EstadisticasEntrenadorService(
            sinHistoria,
        ).perfil({
            gymId: "g1",
            entrenadorId: "e1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.retencion.porcentaje).toBeNull();
    });

    it("no suma monedas: cada divisa lleva su total y su ticket", async () => {
        const perfil = (await new EstadisticasEntrenadorService(base).perfil({
            gymId: "g1",
            entrenadorId: "e1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.ingresos).toHaveLength(2);
        const cup = perfil.ingresos.find((i) => i.monedaId === "cup")!;
        expect(cup.total).toBe(112735);
        expect(cup.ticketMedio).toBe(1848.11);
        // 112735 + 125 = 112860 no debe aparecer en ningún sitio.
        expect(perfil.ingresos.some((i) => i.total === 112860)).toBe(false);
    });

    it("señala el plan que más atiende", async () => {
        const perfil = (await new EstadisticasEntrenadorService(base).perfil({
            gymId: "g1",
            entrenadorId: "e1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.composicion.planLider!.etiqueta).toBe(
            "Mensual con entrenador",
        );
    });

    it("no confunde el horario declarado con la franja observada", async () => {
        const perfil = (await new EstadisticasEntrenadorService(base).perfil({
            gymId: "g1",
            entrenadorId: "e1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.composicion.porFranja[0]!.etiqueta).toBe("Tarde");
        expect(perfil.composicion.porFranjaDeclarada[0]!.etiqueta).toBe(
            "Masculino",
        );
    });

    it("un entrenador de otro gimnasio no existe para la estadística", async () => {
        const vacio: EstadisticasEntrenadorReader = {
            ...base,
            leerEntrenador: async () => null,
        };
        expect(
            await new EstadisticasEntrenadorService(vacio).perfil({
                gymId: "otro",
                entrenadorId: "e1",
                zona: "America/Havana",
                hoy: HOY,
            }),
        ).toBeNull();
    });
});

