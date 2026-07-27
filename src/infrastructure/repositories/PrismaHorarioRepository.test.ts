import { describe, expect, it } from "bun:test";
import { PrismaHorarioRepository } from "./PrismaHorarioRepository";

describe("persistencia CRUD de horarios", () => {
  it("aplica gym_id autenticado a list/get/create/update/delete", async () => {
    const calls: Array<{ method: string; args: any }> = [];
    const delegate = {
      async findMany(args: any) {
        calls.push({ method: "findMany", args });
        return [];
      },
      async findFirst(args: any) {
        calls.push({ method: "findFirst", args });
        return { horario_id: "horario-1", gym_id: "gym-auth" };
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
    const repository = new PrismaHorarioRepository(delegate);

    await repository.findAll("gym-auth");
    await repository.findById("horario-1", "gym-auth");
    await repository.create({
      horario_id: "horario-1",
      nombre_horario: "Mañana",
      hora_inicio: 8,
      hora_fin: 12,
      gym_id: "gym-atacante",
      source_device: "device-atacante",
      version: 1,
    }, "gym-auth");
    await repository.update("horario-1", "gym-auth", { nombre_horario: "Tarde" });
    await repository.softDelete("horario-1", "gym-auth");

    expect(calls[0].args.where).toEqual({ gym_id: "gym-auth", is_deleted: false });
    expect(calls[1].args.where).toEqual({
      horario_id: "horario-1",
      gym_id: "gym-auth",
      is_deleted: false,
    });
    expect(calls[2].args.data.gym_id).toBe("gym-auth");
    expect(calls[3].args.where).toEqual({
      horario_id: "horario-1",
      gym_id: "gym-auth",
      is_deleted: false,
    });
    expect(calls[5].args.where).toEqual({
      horario_id: "horario-1",
      gym_id: "gym-auth",
    });
  });
});
