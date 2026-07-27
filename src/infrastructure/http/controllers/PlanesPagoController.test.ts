import { describe, expect, it } from "bun:test";
import { PlanesPagoController } from "./PlanesPagoController";

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
        return input.id ?? "plan-1";
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

describe("aislamiento JWT de /planes-pago", () => {
  it("propaga el gimnasio autenticado en list/get/create/update/delete", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const existing = {
      id_planes_pago: "plan-1",
      nombre_plan_pago: "Plan",
      importe_plan_pago: 50,
      duracion_plan_pago: 30,
      activo: true,
      moneda_id: "00000000-0000-4000-8000-000000000001",
      acepta_cuotas: false,
      codigo: null,
      precio_viejo_excepcion: null,
      gym_id: "gym-auth",
      source_device: "WEB_ADMIN",
      version: 1,
      is_deleted: false,
    };
    const repository = {
      async findAll(...args: unknown[]) {
        calls.push({ method: "findAll", args });
        return [existing];
      },
      async findById(...args: unknown[]) {
        calls.push({ method: "findById", args });
        return existing;
      },
      async create(...args: unknown[]) {
        calls.push({ method: "create", args });
      },
      async update(...args: unknown[]) {
        calls.push({ method: "update", args });
      },
      async softDelete(...args: unknown[]) {
        calls.push({ method: "softDelete", args });
      },
      async upsertPlanesPago() {},
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
    const controller = new PlanesPagoController(repository as any, syncLog as any);
    const base = { gymId: "gym-auth", id: "plan-1" };

    await controller.list(context(base));
    await controller.getById(context(base));
    await controller.create(context({
      ...base,
      body: {
        nombre_plan_pago: "Plan nuevo",
        importe_plan_pago: 90,
        duracion_plan_pago: 90,
        moneda_id: "00000000-0000-4000-8000-000000000001",
        acepta_cuotas: true,
        codigo: "TRI",
        precio_viejo_excepcion: 75,
        gym_id: "gym-atacante",
      },
    }));
    await controller.update(context({
      ...base,
      body: { codigo: "TRI-2", gym_id: "gym-atacante" },
    }));
    await controller.delete(context(base));

    for (const call of calls.filter((item) =>
      ["findAll", "findById", "create", "update", "softDelete"].includes(item.method)
    )) {
      expect(call.args).toContain("gym-auth");
      expect(call.args).not.toContain("gym-atacante");
    }
    const created = calls.find((call) => call.method === "create")!;
    expect((created.args[0] as any).gym_id).toBe("gym-auth");
    expect((created.args[0] as any).source_device).toBe("WEB_ADMIN");
    expect((created.args[0] as any).acepta_cuotas).toBe(true);
    expect((created.args[0] as any).codigo).toBe("TRI");
    expect((created.args[0] as any).precio_viejo_excepcion).toBe(75);
  });

  it("rechaza requests sin gimnasio en el JWT", async () => {
    let touched = false;
    const repository = new Proxy({}, {
      get() {
        return async () => {
          touched = true;
        };
      },
    });
    const controller = new PlanesPagoController(repository as any, repository as any);
    const response = await controller.list(context({}));
    expect(response.status).toBe(403);
    expect(touched).toBe(false);
  });
});
