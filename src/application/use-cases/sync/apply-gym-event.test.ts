import { describe, expect, it } from "bun:test";
import { ApplyGymEventUseCase } from "./ApplyGymEventUseCase";

const SEDE_PROPIA = "local-gym-001";
const SEDE_NUEVA = "26eeb6e0-0499-4918-8897-6f3e07567669";
const SEDE_AJENA = "dms-gym-norte";

function repo(existentes: string[]) {
    const upserts: any[] = [];
    const borradas: string[] = [];
    return {
        upserts,
        borradas,
        withTransaction() { return this; },
        async exists(id: string) { return existentes.includes(id); },
        async upsertGym(gym: any) { upserts.push(gym); },
        async softDelete(id: string) { borradas.push(id); },
    } as any;
}

const evento = (entidadId: string, operacion: any = "INSERT") => ({
    eventId: "ev-1",
    entidadId,
    operacion,
    gymId: SEDE_PROPIA,
    deviceId: "dev-1",
    payload: { codigo: "NUE", nombre: "Sede nueva", activo: true },
});

describe("sedes que llegan por sincronización", () => {
    it("acepta el alta de una sede NUEVA hecha desde el escritorio", async () => {
        // El Dueño da de alta una sede desde la ventana: por definición tiene un
        // identificador distinto al de la instalación. Hasta el 27-07 esto se
        // rechazaba y el alta se quedaba en local (docs/MULTI_SEDE.md §3).
        const destino = repo([SEDE_PROPIA]);
        await new ApplyGymEventUseCase(destino).execute(evento(SEDE_NUEVA));
        expect(destino.upserts).toHaveLength(1);
        expect(destino.upserts[0].gym_id).toBe(SEDE_NUEVA);
    });

    it("sigue aceptando que una instalación mantenga su propia sede", async () => {
        const destino = repo([SEDE_PROPIA]);
        await new ApplyGymEventUseCase(destino).execute(
            evento(SEDE_PROPIA, "UPDATE"),
        );
        expect(destino.upserts).toHaveLength(1);
    });

    it("rechaza modificar una sede ajena que ya existe", async () => {
        // Es la puerta que la guarda original protegía y que sigue cerrada:
        // si no, un dispositivo podría renombrar el gimnasio de otra sede.
        const destino = repo([SEDE_PROPIA, SEDE_AJENA]);
        await expect(
            new ApplyGymEventUseCase(destino).execute(evento(SEDE_AJENA, "UPDATE")),
        ).rejects.toThrow(/solo modifica su propia sede/);
        expect(destino.upserts).toHaveLength(0);
    });

    it("rechaza dar de baja una sede ajena por sincronización", async () => {
        // El canal autentica al DISPOSITIVO, no a la persona, así que no puede
        // demostrar la autoridad de Dueño. La baja ajena se hace desde la web.
        const destino = repo([SEDE_PROPIA, SEDE_AJENA]);
        await expect(
            new ApplyGymEventUseCase(destino).execute(evento(SEDE_AJENA, "DELETE")),
        ).rejects.toThrow(/se hace desde la web/);
        expect(destino.borradas).toHaveLength(0);
    });

    it("deja que la instalación dé de baja su propia sede", async () => {
        const destino = repo([SEDE_PROPIA]);
        await new ApplyGymEventUseCase(destino).execute(
            evento(SEDE_PROPIA, "DELETE"),
        );
        expect(destino.borradas).toEqual([SEDE_PROPIA]);
    });

    it("exige que el token declare gimnasio", async () => {
        const destino = repo([]);
        await expect(
            new ApplyGymEventUseCase(destino).execute({
                ...evento(SEDE_NUEVA),
                gymId: "",
            }),
        ).rejects.toThrow(/no declara gimnasio/);
    });
});
