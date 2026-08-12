import { describe, expect, test } from "bun:test";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { SyncLogRecord } from "../../../domain/repositories/SyncLogRepository";
import { CreateClienteUseCase } from "./CreateClienteUseCase";

type State = {
    clients: Cliente[];
    logs: SyncLogRecord[];
};

function fixture(failOnLog?: number) {
    const committed: State = { clients: [], logs: [] };
    const clientRepository: any = {
        withTransaction(tx: State) {
            return {
                ...this,
                async create(client: Cliente) {
                    tx.clients.push(client);
                    return {
                        client,
                        nationalityCode: "CU",
                        membership: {
                            membresia_id: "membership-demo",
                            ci: client.ci,
                            id_planes_pago: client.id_planes_pago,
                            id_entrenador: client.id_entrenador,
                            estado: "PENDIENTE_PAGO",
                            gym_id: client.gym_id,
                        },
                        assignment: {
                            asignacion_id: "assignment-demo",
                            membresia_id: "membership-demo",
                            id_entrenador: client.id_entrenador,
                            gym_id: client.gym_id,
                        },
                    };
                },
                async findById(id: string) {
                    const client = tx.clients.find((row) => row.ci === id);
                    return client
                        ? {
                              ...client,
                              membresia_vigencia: "PENDIENTE_PAGO",
                              membresia_cubre_hoy: false,
                          }
                        : null;
                },
            };
        },
    };
    const weightRepository: any = {
        withTransaction() {
            return this;
        },
    };
    const syncLogRepository: any = {
        async register(record: SyncLogRecord, tx?: State) {
            if (!tx) throw new Error("sync_log se intentó escribir fuera de la transacción");
            tx.logs.push(record);
            if (failOnLog === tx.logs.length) {
                throw new Error("fallo inyectado de sync_log");
            }
        },
    };
    const runTransaction = async <T>(work: (tx: State) => Promise<T>) => {
        const staged: State = {
            clients: [...committed.clients],
            logs: [...committed.logs],
        };
        const result = await work(staged);
        committed.clients = staged.clients;
        committed.logs = staged.logs;
        return result;
    };
    const useCase = new CreateClienteUseCase(
        clientRepository,
        syncLogRepository,
        weightRepository,
        runTransaction as any,
        async () => new Date("2026-08-12T00:00:00.000Z"),
    );
    return { committed, useCase };
}

const dto = {
    ci: "demo-create-pay",
    tipo_documento: "PASAPORTE" as const,
    fecha_nacimiento: "1990-01-15",
    nombres: "Alta",
    apellidos: "Cobro Demo",
    sexo: "F",
    estatura_cliente: 165,
    nacionalidad_id: "nationality-demo",
    id_planes_pago: "plan-demo",
    id_entrenador: "trainer-demo",
    fecha_inicio: "2026-08-12T00:00:00.000Z",
    fecha_fin: "2026-09-11T00:00:00.000Z",
    activo: false,
};

describe("CreateClienteUseCase · atomicidad de alta y sync", () => {
    test("confirma cliente, membresía y asignación con sus eventos juntos", async () => {
        const { committed, useCase } = fixture();

        const created = await useCase.execute(dto, "gym-demo");

        expect(created.membresia_estado).toBe("PENDIENTE_PAGO");
        expect(committed.clients).toHaveLength(1);
        expect(committed.logs.map((row) => row.entidad)).toEqual([
            "cliente",
            "membresia_cliente",
            "membresia_entrenador_asignacion",
        ]);
    });

    test("revierte toda el alta cuando falla cualquiera de sus sync_log", async () => {
        const { committed, useCase } = fixture(2);

        await expect(useCase.execute(dto, "gym-demo")).rejects.toThrow(
            "fallo inyectado de sync_log",
        );

        expect(committed.clients).toHaveLength(0);
        expect(committed.logs).toHaveLength(0);
    });
});
