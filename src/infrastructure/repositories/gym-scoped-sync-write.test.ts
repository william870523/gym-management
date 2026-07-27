import { describe, expect, it } from "bun:test";
import {
  softDeleteGymScopedSyncRecord,
  upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";

function delegateWithOwner(owner: string | null | undefined) {
  const calls: Array<{ method: string; args: any }> = [];
  return {
    calls,
    delegate: {
      async findUnique(args: any) {
        calls.push({ method: "findUnique", args });
        return owner === undefined ? null : { gym_id: owner };
      },
      async updateMany(args: any) {
        calls.push({ method: "updateMany", args });
        return { count: 1 };
      },
      async create(args: any) {
        calls.push({ method: "create", args });
        return args.data;
      },
    },
  };
}

describe("escrituras de sync con pertenencia de gimnasio", () => {
  it("rechaza una PK ajena antes de escribir", async () => {
    const mock = delegateWithOwner("gym-b");
    await expect(upsertGymScopedSyncRecord({
      delegate: mock.delegate,
      entity: "cliente",
      pk: "ci",
      id: "V-1",
      gymId: "gym-a",
      create: { gym_id: "gym-atacante" },
      update: { gym_id: "gym-atacante" },
    })).rejects.toThrow("otro gimnasio");
    expect(mock.calls.map((call) => call.method)).toEqual(["findUnique"]);
  });

  it("actualiza únicamente por PK y gimnasio autenticado", async () => {
    const mock = delegateWithOwner("gym-a");
    await upsertGymScopedSyncRecord({
      delegate: mock.delegate,
      entity: "cliente",
      pk: "ci",
      id: "V-1",
      gymId: "gym-a",
      create: {},
      update: { ci: "V-falsa", gym_id: "gym-atacante", nombres: "Ana" },
    });
    expect(mock.calls[1]).toEqual({
      method: "updateMany",
      args: {
        where: { ci: "V-1", gym_id: "gym-a" },
        data: { gym_id: "gym-a", nombres: "Ana" },
      },
    });
  });

  it("crea una PK nueva con pertenencia autoritativa", async () => {
    const mock = delegateWithOwner(undefined);
    await upsertGymScopedSyncRecord({
      delegate: mock.delegate,
      entity: "cliente",
      pk: "ci",
      id: "V-1",
      gymId: "gym-a",
      create: { ci: "V-falsa", gym_id: "gym-atacante", nombres: "Ana" },
      update: {},
    });
    expect(mock.calls[1]).toEqual({
      method: "create",
      args: {
        data: { ci: "V-1", gym_id: "gym-a", nombres: "Ana" },
      },
    });
  });

  it("rechaza el borrado de una PK ajena", async () => {
    const mock = delegateWithOwner("gym-b");
    await expect(softDeleteGymScopedSyncRecord({
      delegate: mock.delegate,
      entity: "planes_pago",
      pk: "id_planes_pago",
      id: "plan-1",
      gymId: "gym-a",
      now: new Date("2026-07-21T12:00:00.000Z"),
    })).rejects.toThrow("otro gimnasio");
    expect(mock.calls.map((call) => call.method)).toEqual(["findUnique"]);
  });
});
