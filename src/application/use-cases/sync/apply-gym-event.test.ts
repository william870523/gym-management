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

const evento = (
    entidadId: string,
    operacion: any = "INSERT",
    extra: Record<string, unknown> = {},
) => ({
    eventId: "ev-1",
    entidadId,
    operacion,
    gymId: SEDE_PROPIA,
    deviceId: "dev-1",
    payload: { codigo: "NUE", nombre: "Sede nueva", activo: true, ...extra },
});

/** Comprobación de autoridad: solo `u-dueno` es Dueño de la cadena. */
const autoridad = async (userId: string) => userId === "u-dueno";

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

    it("acepta la baja de una sede ajena si la pidió el Dueño de la cadena", async () => {
        // El canal autentica al DISPOSITIVO, así que el evento dice QUIÉN la
        // pidió y la autoridad se busca en la base del remoto.
        const destino = repo([SEDE_PROPIA, SEDE_AJENA]);
        await new ApplyGymEventUseCase(destino, autoridad).execute(
            evento(SEDE_AJENA, "DELETE", { dado_de_baja_por_user_id: "u-dueno" }),
        );
        expect(destino.borradas).toEqual([SEDE_AJENA]);
    });

    it("rechaza la baja ajena si quien la pidió NO es Dueño", async () => {
        const destino = repo([SEDE_PROPIA, SEDE_AJENA]);
        await expect(
            new ApplyGymEventUseCase(destino, autoridad).execute(
                evento(SEDE_AJENA, "DELETE", { dado_de_baja_por_user_id: "u-ana" }),
            ),
        ).rejects.toThrow(/no es dueña de la cadena/);
        expect(destino.borradas).toHaveLength(0);
    });

    it("rechaza la baja ajena si el evento no dice quién la pidió", async () => {
        // Un evento viejo, anterior a que el actor viajara, no puede colarse.
        const destino = repo([SEDE_PROPIA, SEDE_AJENA]);
        await expect(
            new ApplyGymEventUseCase(destino, autoridad).execute(
                evento(SEDE_AJENA, "DELETE"),
            ),
        ).rejects.toThrow(/no dice quién la pidió/);
        expect(destino.borradas).toHaveLength(0);
    });

    it("no se fía del payload: sin comprobación de autoridad, no borra", async () => {
        // El constructor por defecto responde que nadie es Dueño: falla cerrado.
        const destino = repo([SEDE_PROPIA, SEDE_AJENA]);
        await expect(
            new ApplyGymEventUseCase(destino).execute(
                evento(SEDE_AJENA, "DELETE", { dado_de_baja_por_user_id: "u-dueno" }),
            ),
        ).rejects.toThrow(/no es dueña de la cadena/);
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
