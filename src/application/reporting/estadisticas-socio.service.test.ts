import { describe, expect, it } from "bun:test";
import {
    diasDesdeUltima,
    edadEn,
    EstadisticasSocioService,
    franjaDe,
    agruparVisitasPorMes,
    rachaActual,
    rachaMaxima,
    tasa,
} from "./estadisticas-socio.service";
import type {
    EstadisticasSocioReader,
} from "./estadisticas-socio.reader";

const HOY = new Date("2026-07-30T00:00:00.000Z");

describe("toda tasa lleva su denominador", () => {
    it("un 100 % sobre dos casos no se puede confundir con uno sobre doscientos", () => {
        expect(tasa(2, 2)).toEqual({ casos: 2, base: 2, porcentaje: 100 });
        expect(tasa(200, 200)).toEqual({ casos: 200, base: 200, porcentaje: 100 });
    });

    it("sin base no se inventa un porcentaje", () => {
        expect(tasa(0, 0).porcentaje).toBeNull();
    });
});

describe("rachas de asistencia", () => {
    it("la racha máxima cuenta días consecutivos", () => {
        expect(
            rachaMaxima(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-10"]),
        ).toBe(3);
    });

    it("la racha actual solo cuenta si sigue viva hoy o ayer", () => {
        // Terminó hace semanas: no es «actual».
        expect(rachaActual(["2026-07-01", "2026-07-02"], HOY)).toBe(0);
        // Viene hoy y ayer: racha de dos.
        expect(rachaActual(["2026-07-29", "2026-07-30"], HOY)).toBe(2);
        // Vino ayer y antes de ayer: sigue contando.
        expect(rachaActual(["2026-07-28", "2026-07-29"], HOY)).toBe(2);
    });

    it("sin visitas no hay racha", () => {
        expect(rachaMaxima([])).toBe(0);
        expect(rachaActual([], HOY)).toBe(0);
        expect(diasDesdeUltima([], HOY)).toBeNull();
    });

    it("los días desde la última visita se miden en días de calendario", () => {
        expect(diasDesdeUltima(["2026-07-23"], HOY)).toBe(7);
        expect(diasDesdeUltima(["2026-07-30"], HOY)).toBe(0);
    });
});

describe("franjas horarias", () => {
    it("reparte la hora local en la franja que le toca", () => {
        expect(franjaDe(7)).toBe("Mañana");
        expect(franjaDe(15)).toBe("Tarde");
        expect(franjaDe(20)).toBe("Noche");
        expect(franjaDe(3)).toBe("Madrugada");
    });

    it("las fronteras caen del lado correcto", () => {
        expect(franjaDe(12)).toBe("Tarde");
        expect(franjaDe(18)).toBe("Noche");
        expect(franjaDe(5)).toBe("Mañana");
    });
});

describe("serie mensual de asistencia", () => {
    it("se deriva de los mismos días locales que alimentan rachas y franjas", () => {
        expect(
            agruparVisitasPorMes([
                { dia: "2026-06-30", hora: 23, diaSemana: 2, minutos: 40 },
                { dia: "2026-07-01", hora: 0, diaSemana: 3, minutos: 50 },
                { dia: "2026-07-02", hora: 8, diaSemana: 4, minutos: null },
            ]),
        ).toEqual([
            { mes: "2026-06", total: 1 },
            { mes: "2026-07", total: 2 },
        ]);
    });
});

describe("edad", () => {
    it("descuenta el año si aún no ha cumplido", () => {
        expect(edadEn(new Date("1985-04-20T00:00:00.000Z"), HOY)).toBe(41);
        expect(edadEn(new Date("1985-12-20T00:00:00.000Z"), HOY)).toBe(40);
    });

    it("sin fecha no se inventa una edad", () => {
        expect(edadEn(null, HOY)).toBeNull();
    });
});

describe("perfil completo", () => {
    const reader: EstadisticasSocioReader = {
        leerSocio: async () => ({
            ci: "85042012345",
            nombres: "Luis",
            apellidos: "Pérez",
            sexo: "Masculino",
            fecha_nacimiento: new Date("1985-04-20T00:00:00.000Z"),
            estatura: 178,
            objetivo: "Ganar masa muscular",
            categoria: "NUEVO",
            nacionalidad_id: "cu",
            id_horarios: "manana",
            id_entrenador: null,
            creado: new Date("2026-01-10T00:00:00.000Z"),
        }),
        leerAsistencias: async () => [
            { dia: "2026-07-28", hora: 7, diaSemana: 2, minutos: 60 },
            { dia: "2026-07-29", hora: 7, diaSemana: 3, minutos: 90 },
            { dia: "2026-07-30", hora: 19, diaSemana: 4, minutos: null },
        ],
        leerCobrosPorMoneda: async () => [
            {
                moneda_id: "cup",
                cobros: 3,
                total: 6000,
                primero: new Date("2026-05-01T00:00:00.000Z"),
                ultimo: new Date("2026-07-01T00:00:00.000Z"),
            },
            {
                moneda_id: "eur",
                cobros: 1,
                total: 25,
                primero: new Date("2026-06-01T00:00:00.000Z"),
                ultimo: new Date("2026-06-01T00:00:00.000Z"),
            },
        ],
        leerCobrosPorMedio: async () => [
            { etiqueta: "Efectivo", total: 3 },
            { etiqueta: "Transferencia", total: 1 },
        ],
        leerMora: async () => ({
            cobrosConRecargo: 1,
            recargoTotal: 200,
            diasAtrasoPromedio: 4.5,
            condonadoTotal: 0,
        }),
        leerPesos: async () => [
            { fecha: new Date("2026-05-15T00:00:00.000Z"), peso: 82 },
            { fecha: new Date("2026-07-15T00:00:00.000Z"), peso: 79.4 },
        ],
        leerMembresias: async () => [
            {
                membresia_id: "m1",
                plan_nombre: "Mensual",
                precio: 2000,
                moneda_id: "cup",
                fecha_inicio: new Date("2026-05-01T00:00:00.000Z"),
                fecha_fin: new Date("2026-05-31T00:00:00.000Z"),
                estado: "VENCIDA",
                origen: "ALTA",
                id_entrenador: null,
            },
            {
                membresia_id: "m2",
                plan_nombre: "Mensual",
                precio: 2000,
                moneda_id: "cup",
                fecha_inicio: new Date("2026-06-01T00:00:00.000Z"),
                fecha_fin: new Date("2026-06-30T00:00:00.000Z"),
                estado: "VENCIDA",
                origen: "RENOVACION",
                id_entrenador: null,
            },
            {
                membresia_id: "m3",
                plan_nombre: "Trimestral",
                precio: 5400,
                moneda_id: "cup",
                fecha_inicio: new Date("2026-07-01T00:00:00.000Z"),
                fecha_fin: new Date("2026-09-29T00:00:00.000Z"),
                estado: "ACTIVA",
                origen: "CAMBIO",
                id_entrenador: null,
            },
        ],
        leerDiasPausados: async () => 5,
    };

    it("no mezcla monedas: cada divisa lleva su total y su ticket", async () => {
        const servicio = new EstadisticasSocioService(reader);
        const perfil = await servicio.perfil({
            gymId: "g1",
            ci: "85042012345",
            zona: "America/Havana",
            hoy: HOY,
        });

        expect(perfil).not.toBeNull();
        expect(perfil!.dinero.porMoneda).toHaveLength(2);
        const cup = perfil!.dinero.porMoneda.find((m) => m.monedaId === "cup")!;
        expect(cup.total).toBe(6000);
        expect(cup.ticketMedio).toBe(2000);
        const eur = perfil!.dinero.porMoneda.find((m) => m.monedaId === "eur")!;
        expect(eur.total).toBe(25);
        // Y en ningún sitio aparece 6025.
        expect(
            perfil!.dinero.porMoneda.some((m) => m.total === 6025),
        ).toBe(false);
    });

    it("resuelve constancia, franja y permanencia", async () => {
        const servicio = new EstadisticasSocioService(reader);
        const perfil = (await servicio.perfil({
            gymId: "g1",
            ci: "85042012345",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.constancia.visitas).toBe(3);
        expect(perfil.constancia.rachaActual).toBe(3);
        expect(perfil.constancia.diasDesdeUltima).toBe(0);
        // Solo las cerradas cuentan para la media: (60 + 90) / 2.
        expect(perfil.constancia.permanenciaMediaMin).toBe(75);
        expect(perfil.constancia.porFranja[0]!.franja).toBe("Mañana");
        expect(perfil.constancia.porDiaSemana).toHaveLength(7);
    });

    it("mide el aprovechamiento contra los días cubiertos, sin las pausas", async () => {
        const servicio = new EstadisticasSocioService(reader);
        const perfil = (await servicio.perfil({
            gymId: "g1",
            ci: "85042012345",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        // Cobertura: mayo 30 + junio 29 + julio-septiembre 90 = 149 días, menos
        // 5 de pausa = 144. Visitó 3 días distintos.
        expect(perfil.constancia.aprovechamiento.base).toBe(144);
        expect(perfil.constancia.aprovechamiento.casos).toBe(3);
    });

    it("cuenta renovaciones y cambios por el origen del contrato", async () => {
        const servicio = new EstadisticasSocioService(reader);
        const perfil = (await servicio.perfil({
            gymId: "g1",
            ci: "85042012345",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.contrato.altas).toBe(1);
        expect(perfil.contrato.renovaciones).toBe(1);
        expect(perfil.contrato.cambiosDePlan).toBe(1);
        expect(perfil.contrato.planesRecorridos).toEqual(["Mensual", "Trimestral"]);
        // Dos oportunidades terminadas y una renovación: 1 de 2. La
        // renovación no vuelve a sumarse al denominador.
        expect(perfil.contrato.tasaRenovacion.base).toBe(2);
        expect(perfil.contrato.tasaRenovacion.casos).toBe(1);
        expect(perfil.contrato.tasaRenovacion.porcentaje).toBe(50);
    });

    it("calcula el IMC con la estatura en metros y el peso más reciente", async () => {
        const servicio = new EstadisticasSocioService(reader);
        const perfil = (await servicio.perfil({
            gymId: "g1",
            ci: "85042012345",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        expect(perfil.cuerpo.pesoInicial).toBe(82);
        expect(perfil.cuerpo.pesoActual).toBe(79.4);
        expect(perfil.cuerpo.delta).toBe(-2.6);
        // 79.4 / 1.78² = 25.06…
        expect(perfil.cuerpo.imc).toBe(25.1);
    });

    it("la puntualidad se expresa como cobros sin recargo sobre el total", async () => {
        const servicio = new EstadisticasSocioService(reader);
        const perfil = (await servicio.perfil({
            gymId: "g1",
            ci: "85042012345",
            zona: "America/Havana",
            hoy: HOY,
        }))!;

        // 4 cobros en total, 1 con recargo.
        expect(perfil.dinero.mora.puntualidad).toEqual({
            casos: 3,
            base: 4,
            porcentaje: 75,
        });
        expect(perfil.dinero.mora.diasAtrasoPromedio).toBe(4.5);
    });

    it("un socio de otro gimnasio no existe para la estadística", async () => {
        const vacio: EstadisticasSocioReader = {
            ...reader,
            leerSocio: async () => null,
        };
        const servicio = new EstadisticasSocioService(vacio);
        expect(
            await servicio.perfil({
                gymId: "otro",
                ci: "85042012345",
                zona: "America/Havana",
                hoy: HOY,
            }),
        ).toBeNull();
    });
});

