import { describe, expect, it } from "bun:test";
import { PrismaPlanesPagoRepository } from "./PrismaPlanesPagoRepository";

describe("persistencia sync de planes de pago", () => {
  it("conserva atributos R5.2/R5.3 al actualizar sin tocar la base", async () => {
    let updateArgs: any = null;
    const delegate = {
      async findUnique() {
        return { gym_id: "gym-auth" };
      },
      async updateMany(args: any) {
        updateArgs = args;
        return { count: 1 };
      },
      async create() {
        throw new Error("no debe crear");
      },
    };
    const repository = new PrismaPlanesPagoRepository(delegate);
    await repository.upsertPlanesPago({
      id_planes_pago: "plan-1",
      nombre_plan_pago: "Plan trimestral",
      importe_plan_pago: 150,
      duracion_plan_pago: 90,
      activo: true,
      moneda_id: "USD",
      incluye_entrenador: true,
      comision_entrenador_tipo: "PERCENTAGE",
      comision_entrenador_valor: 10,
      acepta_cuotas: true,
      codigo: "TRI",
      precio_viejo_excepcion: 120,
      gym_id: "gym-auth",
      source_device: "device-auth",
      version: 3,
    });
    expect(updateArgs.where).toEqual({
      id_planes_pago: "plan-1",
      gym_id: "gym-auth",
    });
    expect(updateArgs.data).toMatchObject({
      acepta_cuotas: true,
      codigo: "TRI",
      precio_viejo_excepcion: 120,
      gym_id: "gym-auth",
      source_device: "device-auth",
    });
  });

  it("aplica gym_id a todas las consultas y mutaciones CRUD", async () => {
    const calls: Array<{ method: string; args: any }> = [];
    const delegate = {
      async findMany(args: any) {
        calls.push({ method: "findMany", args });
        return [];
      },
      async findFirst(args: any) {
        calls.push({ method: "findFirst", args });
        return null;
      },
      async findUnique(args: any) {
        calls.push({ method: "findUnique", args });
        return { gym_id: "gym-auth" };
      },
      async create(args: any) {
        calls.push({ method: "create", args });
        return args.data;
      },
      async updateMany(args: any) {
        calls.push({ method: "updateMany", args });
        return { count: 1 };
      },
    };
    const repository = new PrismaPlanesPagoRepository(delegate);
    const plan = {
      id_planes_pago: "plan-1",
      nombre_plan_pago: "Plan",
      importe_plan_pago: 50,
      duracion_plan_pago: 30,
      activo: true,
      moneda_id: "USD",
      gym_id: "gym-atacante",
      source_device: "WEB_ADMIN",
      version: 1,
    };

    await repository.findAll("gym-auth");
    await repository.findById("plan-1", "gym-auth");
    await repository.create(plan, "gym-auth");
    await repository.update("plan-1", "gym-auth", { nombre_plan_pago: "Nuevo" });
    await repository.softDelete("plan-1", "gym-auth");

    expect(calls[0].args.where).toEqual({ gym_id: "gym-auth", is_deleted: false });
    expect(calls[1].args.where).toEqual({
      id_planes_pago: "plan-1",
      gym_id: "gym-auth",
      is_deleted: false,
    });
    expect(calls[2].args.data.gym_id).toBe("gym-auth");
    expect(calls[3].args.where).toEqual({
      id_planes_pago: "plan-1",
      gym_id: "gym-auth",
      is_deleted: false,
    });
    expect(calls[5].args.where).toEqual({
      id_planes_pago: "plan-1",
      gym_id: "gym-auth",
    });
  });
});
