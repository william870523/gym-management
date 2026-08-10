import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PARITY_SYNC_TARGET_DEFINITIONS } from "./sync-event-contract";
const CATALOGO = resolve(import.meta.dir, "../../../../../shared/catalogos/roles-producto.ts");


/** Solo el bloque de declaraciones del catálogo, sin el resto del archivo. */
function bloqueDelCatalogo(): string {
  const texto = readFileSync(CATALOGO, "utf8");
  return texto.slice(
    texto.indexOf("ROLES_PRODUCTO"),
    texto.indexOf("sembrarRolesDelProducto"),
  );
}

import { prisma } from "../../../infrastructure/db/prismaClient";

/**
 * ADR-roles-multitenant (02-08-2026, opción A) — los roles son del **producto**,
 * no de la sede.
 *
 * Esta prueba existe porque la decisión es fácil de deshacer sin querer: basta
 * con que alguien añada `roles` al contrato de sync «por simetría» con los demás
 * catálogos, o con que un alta rellene `gym_id` pensando que así aísla. Ninguna
 * de las dos cosas daría error por sí sola; simplemente reabriría la
 * contradicción que este ADR cerró.
 */
describe("contrato global de roles (ADR opción A)", () => {
  test("`roles` y `permissions` NO están en el contrato de sync de sede", () => {
    const entidades = Object.keys(PARITY_SYNC_TARGET_DEFINITIONS);
    expect(entidades).not.toContain("roles");
    expect(entidades).not.toContain("role");
    expect(entidades).not.toContain("permissions");
    expect(entidades).not.toContain("permission");
    // Guarda contra el vacío: si el mapa se quedara sin entidades, las cuatro
    // aserciones de arriba pasarían sin comprobar nada.
    expect(entidades.length).toBeGreaterThan(4);
  });

  test("el mapa de subida tampoco los acepta", () => {
    const uso = readFileSync(resolve(import.meta.dir, "./UploadEventsUseCase.ts"), "utf8");
    const mapa = uso.slice(uso.indexOf("const mapping"), uso.indexOf("const mapping") + 8000);
    expect(/^s*roles?:/m.test(mapa)).toBe(false);
    expect(/^s*permissions?:/m.test(mapa)).toBe(false);
  });

  test("ningún rol ni permiso lleva sede", async () => {
    const rolesConSede = await prisma.role.count({ where: { gym_id: { not: null } } });
    const permisosConSede = await prisma.permission.count({
      where: { gym_id: { not: null } },
    });

    expect(rolesConSede).toBe(0);
    expect(permisosConSede).toBe(0);
  });

  test("el catálogo del producto está sembrado y con nombres únicos", async () => {
    const roles = await prisma.role.findMany({ select: { name: true } });
    const nombres = roles.map((r) => r.name);

    const catalogo = bloqueDelCatalogo();
    const declarados = [...catalogo.matchAll(/name: "(\w+)"/g)].map((m) => m[1]!);
    expect(declarados.length).toBeGreaterThanOrEqual(4);
    for (const nombre of declarados) expect(nombres).toContain(nombre);
    // `name @unique` es, con la opción A, la garantía de identidad del rol.
    expect(new Set(nombres).size).toBe(nombres.length);

    const permisos = await prisma.permission.findMany({ select: { action: true } });
    const acciones = [...catalogo.matchAll(/action: "([\w.]+)"/g)].map((m) => m[1]!);
    expect(acciones.length).toBeGreaterThanOrEqual(9);
    expect(permisos.length).toBeGreaterThanOrEqual(acciones.length);
  });

  test("los nombres que compara la autorización siguen existiendo", () => {
    // Los guardianes comparan `auth.role === "admin"`. Renombrar estos valores
    // no es cosmético: rompe la autorización de todas las rutas.
    const nombres = [...bloqueDelCatalogo().matchAll(/name: "(\w+)"/g)].map((m) => m[1]!);
    expect(nombres).toContain("admin");
    expect(nombres).toContain("reception");
  });
});
