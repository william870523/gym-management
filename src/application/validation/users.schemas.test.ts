import { describe, expect, it } from "bun:test";

import { CreateUserSchema, UpdateUserSchema } from "./users.schemas";

describe("contrato de roles de usuario", () => {
  it.each(["admin", "reception", "accounting", "trainer"])(
    "acepta el rol canónico %s al editar",
    (role) => {
      expect(UpdateUserSchema.parse({ role }).role).toBe(role);
    },
  );

  it("crea por defecto una cuenta de recepción", () => {
    const result = CreateUserSchema.parse({
      user_nombre: "Operadora Demo",
      user_email: "operadora@example.test",
      password: "secreto",
    });
    expect(result.role).toBe("reception");
  });

  it("rechaza roles que no pertenecen al catálogo", () => {
    expect(() => UpdateUserSchema.parse({ role: "user" })).toThrow();
    expect(() => UpdateUserSchema.parse({ role: "maintenance" })).toThrow();
  });
});
