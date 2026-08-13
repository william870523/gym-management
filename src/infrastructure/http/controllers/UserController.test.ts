import { describe, expect, it } from "bun:test";
import { UserController } from "./users.controller";

function context(input: {
  gymId?: string;
  body?: Record<string, unknown>;
  id?: string;
}) {
  return {
    get(key: string) {
      return key === "auth" ? { gymId: input.gymId } : undefined;
    },
    req: {
      param() {
        return input.id ?? "user-1";
      },
      async json() {
        return input.body ?? {};
      },
    },
    json(body: unknown, status?: number) {
      return { body, status: status ?? 200 };
    },
  } as any;
}

describe("aislamiento JWT de /users", () => {
  it("propaga gym autenticado y descarta gym/source libres del body", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const existing = {
      user_id: "user-1",
      user_nombre: "Operador",
      user_email: "operator@example.test",
      password: "hash",
      role: "user",
      active: true,
      is_deleted: false,
      created_at: new Date("2026-07-21T00:00:00.000Z"),
      gym_id: "gym-auth",
      source_device: "WEB_ADMIN",
      version: 1,
      updated_at: new Date("2026-07-21T00:00:00.000Z"),
      deleted_at: null,
    };
    const repository: any = {
        // El caso de uso entra en transacción: el doble se devuelve a sí mismo
        // y el ejecutor de mentira solo llama al trabajo.
        withTransaction() { return repository; },
      async findAll(...args: unknown[]) {
        calls.push({ method: "findAll", args });
        return [existing];
      },
      async findByEmail(...args: unknown[]) {
        calls.push({ method: "findByEmail", args });
        return null;
      },
      async findById(...args: unknown[]) {
        calls.push({ method: "findById", args });
        return existing;
      },
      async create(...args: unknown[]) {
        calls.push({ method: "create", args });
        return { ...existing, ...(args[0] as object) };
      },
      async update(...args: unknown[]) {
        calls.push({ method: "update", args });
        return { ...existing, ...(args[2] as object) };
      },
      async softDelete(...args: unknown[]) {
        calls.push({ method: "softDelete", args });
      },
      async upsertFromSync() {
        return existing;
      },
    };
    const syncLog = {
      async exists() {
        return false;
      },
      async register(...args: unknown[]) {
        calls.push({ method: "register", args });
      },
      async findChanges() {
        return [];
      },
    };
    const controller = new UserController(repository as any, syncLog as any, (fn: any) => fn({ transaccionDeMentira: true }));
    const base = { gymId: "gym-auth", id: "user-1" };

    await controller.getUsers(context(base));
    await controller.getUserById(context(base));
    await controller.createUser(context({
      ...base,
      body: {
        user_nombre: "Administrador",
        user_email: "admin@example.test",
        password: "password-seguro",
        role: "admin",
        active: true,
        gym_id: "gym-atacante",
        source_device: "device-atacante",
      },
    }));
    await controller.updateUser(context({
      ...base,
      body: {
        role: "user",
        gym_id: "gym-atacante",
        source_device: "device-atacante",
      },
    }));
    await controller.deleteUser(context(base));

    for (const call of calls.filter((item) =>
      ["findAll", "findById", "create", "update", "softDelete"].includes(item.method)
    )) {
      expect(call.args).toContain("gym-auth");
      expect(call.args).not.toContain("gym-atacante");
    }
    const created = calls.find((call) => call.method === "create")!;
    expect((created.args[0] as any).gym_id).toBe("gym-auth");
    expect((created.args[0] as any).source_device).toBe("WEB_ADMIN");
  });

  it("rechaza roles fuera de política y requests sin gym JWT", async () => {
    let touched = false;
    const repository = new Proxy({}, {
      get() {
        return async () => {
          touched = true;
          return [];
        };
      },
    });
    const controller = new UserController(repository as any, repository as any, (fn: any) => fn({ transaccionDeMentira: true }));
    const invalidRole = await controller.createUser(context({
      gymId: "gym-auth",
      body: {
        user_nombre: "Atacante",
        user_email: "attacker@example.test",
        password: "password-seguro",
        role: "superadmin",
      },
    }));
    expect(invalidRole.status).toBe(400);
    const missingGym = await controller.getUsers(context({}));
    expect(missingGym.status).toBe(403);
    expect(touched).toBe(false);
  });
});
