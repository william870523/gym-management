import { describe, expect, it } from "bun:test";
import { assertGymScopedReference } from "./gym-scoped-reference";

describe("integridad referencial por gimnasio", () => {
  it("acepta únicamente una relación activa del gimnasio autenticado", async () => {
    const calls: unknown[] = [];
    await assertGymScopedReference({
      delegate: {
        findFirst: async (query: unknown) => {
          calls.push(query);
          return { ci: "cliente-a" };
        },
      },
      entity: "cliente",
      pk: "ci",
      id: "cliente-a",
      gymId: "gym-a",
    });

    expect(calls).toEqual([{
      where: { ci: "cliente-a", gym_id: "gym-a", is_deleted: false },
      select: { ci: true },
    }]);
  });

  it("rechaza una FK existente sólo en otra sede", async () => {
    await expect(assertGymScopedReference({
      delegate: { findFirst: async () => null },
      entity: "cuenta",
      pk: "cuenta_id",
      id: "cuenta-b",
      gymId: "gym-a",
    })).rejects.toThrow("no pertenece al gimnasio autenticado");
  });
});
