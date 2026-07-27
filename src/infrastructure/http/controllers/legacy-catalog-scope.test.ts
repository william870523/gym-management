import { describe, expect, it } from "bun:test";
import {
  createCuenta,
  createHorario,
  createPlanPago,
  getCuentas,
  getHorarios,
  getPlanesPago,
} from "./catalogs.controller";

function context(body: Record<string, unknown> = {}) {
  return {
    get() {
      return undefined;
    },
    req: {
      async json() {
        return body;
      },
      param() {
        return "entity-1";
      },
    },
    json(payload: unknown, status?: number) {
      return { payload, status: status ?? 200 };
    },
  } as any;
}

describe("catálogos legacy scoped", () => {
  it("rechaza lecturas y escrituras sin gym JWT antes de consultar Prisma", async () => {
    const reads = await Promise.all([
      getHorarios(context()),
      getPlanesPago(context()),
      getCuentas(context()),
    ]);
    expect(reads.map((response) => response.status)).toEqual([403, 403, 403]);

    const writes = await Promise.all([
      createHorario(context({
        nombre_horario: "Mañana",
        hora_inicio: 8,
        hora_fin: 12,
        gym_id: "gym-atacante",
      })),
      createPlanPago(context({
        nombre_plan_pago: "Plan",
        importe_plan_pago: 50,
        duracion_plan_pago: 30,
        moneda_id: "00000000-0000-4000-8000-000000000001",
        gym_id: "gym-atacante",
      })),
      createCuenta(context({
        nombre_cuenta: "Caja",
        moneda_id: "00000000-0000-4000-8000-000000000001",
        gym_id: "gym-atacante",
      })),
    ]);
    expect(writes.map((response) => response.status)).toEqual([403, 403, 403]);
  });
});
