import { describe, expect, it } from "bun:test";
import { PrismaUserRepository } from "./PrismaUserRepository";

describe("persistencia CRUD de usuarios", () => {
  it("aplica gym_id autenticado a list/get/create/update/delete", async () => {
    const calls: Array<{ method: string; args: any }> = [];
    const row = {
      user_id: "user-1",
      gym_id: "gym-auth",
      is_deleted: false,
    };
    const delegate = {
      async findMany(args: any) {
        calls.push({ method: "findMany", args });
        return [];
      },
      async findFirst(args: any) {
        calls.push({ method: "findFirst", args });
        return row;
      },
      async findUnique(args: any) {
        calls.push({ method: "findUnique", args });
        return row;
      },
      async create(args: any) {
        calls.push({ method: "create", args });
        return { ...row, ...args.data };
      },
      async updateMany(args: any) {
        calls.push({ method: "updateMany", args });
        return { count: 1 };
      },
    };
    const repository = new PrismaUserRepository(delegate);

    await repository.findAll("gym-auth");
    await repository.findById("user-1", "gym-auth");
    await repository.create({
      user_id: "user-1",
      user_nombre: "Operador",
      user_email: "operator@example.test",
      password: "hash",
      role: "user",
      gym_id: "gym-atacante",
    }, "gym-auth");
    await repository.update("user-1", "gym-auth", {
      user_nombre: "Nuevo",
      gym_id: "gym-atacante",
    });
    await repository.softDelete("user-1", "gym-auth");

    expect(calls[0].args.where).toEqual({ gym_id: "gym-auth", is_deleted: false });
    expect(calls[1].args.where).toEqual({
      user_id: "user-1",
      gym_id: "gym-auth",
      is_deleted: false,
    });
    expect(calls[2].args.data.gym_id).toBe("gym-auth");
    expect(calls[3].args.where).toEqual({
      user_id: "user-1",
      gym_id: "gym-auth",
      is_deleted: false,
    });
    expect(calls[3].args.data.gym_id).toBeUndefined();
    expect(calls[6].args.where).toEqual({
      user_id: "user-1",
      gym_id: "gym-auth",
    });
  });
});
