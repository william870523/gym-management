import { describe, expect, it } from "bun:test";
import { EstadisticasPlanService } from "./estadisticas-plan.service";
import type { EstadisticasPlanReader } from "./estadisticas-plan.reader";

const HOY = new Date("2026-07-30T00:00:00.000Z");

const base: EstadisticasPlanReader = {
    leerPlan: async () => ({
        id: "p1",
        nombre: "Trimestral",
        importe: 5400,
        monedaId: "cup",
        duracionDias: 90,
        activo: true,
        incluyeEntrenador: false,
        aceptaCuotas: true,
        codigo: "TRI",
    }),
    leerEstados: async () => ({
        vigentes: 28,
        pendientes: 2,
        pausadas: 1,
        terminadas: 18,
        socios: 39,
    }),
    leerContratacionesPorMes: async () => [
        { etiqueta: "2026-06", total: 9 },
        { etiqueta: "2026-07", total: 12 },
    ],
    leerComposicion: async (_g, _i, dimension) =>
        dimension === "entrenador"
            ? [{ etiqueta: "Sin entrenador", total: 20 }]
            : [
                  { etiqueta: "Masculino", total: 15 },
                  { etiqueta: "Femenino", total: 13 },
              ],
    leerVienenDe: async () => [
        { etiqueta: "Diario", total: 10 },
        { etiqueta: "Semanal", total: 4 },
    ],
    leerSeVanA: async () => [{ etiqueta: "Semanal", total: 2 }],
    leerRenovacion: async () => ({ renovaciones: 27, terminadas: 45 }),
    leerIngresos: async () => [
        {
            moneda_id: "cup",
            cobros: 45,
            total: 241920,
            descuentoTotal: 8100,
            recargoTotal: 540,
        },
    ],
    leerDuracion: async () => ({ contratada: 90, realMedia: 94.5 }),
    leerUso: async () => ({
        visitas: 882,
        socios: 28,
        porFranja: [
            { etiqueta: "Mañana", total: 600 },
            { etiqueta: "Tarde", total: 282 },
        ],
    }),
    leerCuotas: async () => ({ membresiasConCuotas: 12, cuotas: 36 }),
};

describe("perfil del plan", () => {
    it("dice si el plan gana o pierde socios frente a los demás", async () => {
        const perfil = (await new EstadisticasPlanService(base).perfil({
            gymId: "g1",
            planId: "p1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        // Entran 14, salen 2.
        expect(perfil.movilidad.saldo).toBe(12);
        expect(perfil.movilidad.vienenDe[0]!.etiqueta).toBe("Diario");
        expect(perfil.movilidad.seVanA[0]!.etiqueta).toBe("Semanal");
    });

    it("la renovación lleva su denominador", async () => {
        const perfil = (await new EstadisticasPlanService(base).perfil({
            gymId: "g1",
            planId: "p1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.contratacion.tasaRenovacion.casos).toBe(27);
        expect(perfil.contratacion.tasaRenovacion.base).toBe(45);
        expect(perfil.contratacion.tasaRenovacion.porcentaje).toBe(60);
    });

    it("mide el uso real: si el plan se usa o solo se paga", async () => {
        const perfil = (await new EstadisticasPlanService(base).perfil({
            gymId: "g1",
            planId: "p1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        // 882 visitas repartidas entre 28 socios vigentes.
        expect(perfil.uso.visitasPorSocio).toBe(31.5);
        expect(perfil.composicion.porFranja[0]).toEqual({
            etiqueta: "Mañana",
            total: 600,
        });
    });

    it("sin socios vigentes no divide por cero", async () => {
        const vacio: EstadisticasPlanReader = {
            ...base,
            leerUso: async () => ({ visitas: 0, socios: 0, porFranja: [] }),
        };
        const perfil = (await new EstadisticasPlanService(vacio).perfil({
            gymId: "g1",
            planId: "p1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.uso.visitasPorSocio).toBeNull();
    });

    it("la duración real se compara con la contratada, no la sustituye", async () => {
        const perfil = (await new EstadisticasPlanService(base).perfil({
            gymId: "g1",
            planId: "p1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.duracion.contratadaDias).toBe(90);
        expect(perfil.duracion.realMediaDias).toBe(94.5);
        // La cobertura se estira 4,5 días de media: son las pausas.
        expect(perfil.duracion.desviacionDias).toBe(4.5);
    });

    it("el ingreso separa descuentos y recargos, y no mezcla monedas", async () => {
        const perfil = (await new EstadisticasPlanService(base).perfil({
            gymId: "g1",
            planId: "p1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.dinero).toHaveLength(1);
        const cup = perfil.dinero[0]!;
        expect(cup.total).toBe(241920);
        expect(cup.ticketMedio).toBe(5376);
        expect(cup.descuentoTotal).toBe(8100);
        expect(cup.recargoTotal).toBe(540);
    });

    it("expone cuántos contratos se fraccionaron", async () => {
        const perfil = (await new EstadisticasPlanService(base).perfil({
            gymId: "g1",
            planId: "p1",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.cuotas.membresiasFraccionadas).toBe(12);
        expect(perfil.cuotas.cuotasEmitidas).toBe(36);
    });

    it("un plan de otro gimnasio no existe para la estadística", async () => {
        const vacio: EstadisticasPlanReader = {
            ...base,
            leerPlan: async () => null,
        };
        expect(
            await new EstadisticasPlanService(vacio).perfil({
                gymId: "otro",
                planId: "p1",
                zona: "America/Havana",
                hoy: HOY,
            }),
        ).toBeNull();
    });
});

