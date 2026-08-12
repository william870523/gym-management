import { describe, expect, test } from "bun:test";
import {
  AsistenciaPermanenciaError,
  AsistenciaPermanenciaService,
} from "./asistencia-permanencia.service";

function fakeTransaction(options: { failSync?: boolean; missing?: boolean } = {}) {
  const initial = {
    asistencia_id: "attendance-1",
    gym_id: "gym-1",
    is_deleted: false,
    fecha_salida: null as Date | null,
    pausa_inicio: null as Date | null,
    pausa_ms: 0,
    version: 1,
    updated_at: new Date("2026-08-10T00:00:00.000Z"),
  };
  let state = structuredClone(initial);
  const logs: any[] = [];

  const client = {
    async $transaction(work: (tx: any) => Promise<any>) {
      const draft = structuredClone(state);
      const draftLogs = [...logs];
      const tx = {
        asistencia: {
          findFirst: async () => options.missing ? null : draft,
          updateMany: async ({ data }: any) => {
            if (options.missing) return { count: 0 };
            if (data.pausa_inicio !== undefined) draft.pausa_inicio = data.pausa_inicio;
            if (data.pausa_ms !== undefined) draft.pausa_ms = data.pausa_ms;
            if (data.fecha_salida !== undefined) draft.fecha_salida = data.fecha_salida;
            draft.version += data.version.increment;
            draft.updated_at = data.updated_at;
            return { count: 1 };
          },
        },
        syncLog: {
          create: async ({ data }: any) => {
            if (options.failSync) throw new Error("sync_log falló");
            draftLogs.push(data);
          },
        },
      };
      const result = await work(tx);
      state = draft;
      logs.splice(0, logs.length, ...draftLogs);
      return result;
    },
  };

  return { client, state: () => state, logs };
}

describe("asistencia remota · permanencia transaccional", () => {
  test("pausa la visita y registra un único UPDATE", async () => {
    const fake = fakeTransaction();
    const service = new AsistenciaPermanenciaService(
      fake.client as any,
      () => "event-pause",
    );

    const result = await service.pause("gym-1", "attendance-1");

    expect(result.pausa_inicio).toBeInstanceOf(Date);
    expect(result.version).toBe(2);
    expect(fake.logs).toHaveLength(1);
    expect(fake.logs[0]).toMatchObject({
      event_id: "event-pause",
      entidad: "asistencia",
      operacion: "UPDATE",
      entidad_id: "attendance-1",
      gym_id: "gym-1",
    });
  });

  test("si sync_log falla, la pausa no queda confirmada", async () => {
    const fake = fakeTransaction({ failSync: true });
    const before = structuredClone(fake.state());
    const service = new AsistenciaPermanenciaService(fake.client as any);

    await expect(service.pause("gym-1", "attendance-1")).rejects.toThrow(
      "sync_log falló",
    );
    expect(fake.state()).toEqual(before);
    expect(fake.logs).toHaveLength(0);
  });

  test("una asistencia ajena o inexistente falla como 404 sin evento", async () => {
    const fake = fakeTransaction({ missing: true });
    const service = new AsistenciaPermanenciaService(fake.client as any);

    let captured: unknown;
    try {
      await service.finalize("gym-2", "attendance-1");
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(AsistenciaPermanenciaError);
    expect((captured as AsistenciaPermanenciaError).status).toBe(404);
    expect(fake.logs).toHaveLength(0);
  });
});
