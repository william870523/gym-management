/**
 * ADR-roles-multitenant, opción A — catálogo global de roles del producto.
 *
 * Gemelo del script local. Normaliza `gym_id = NULL` en `roles` y
 * `permissions`, siembra el catálogo canónico compartido y verifica que no haya
 * nombres repetidos.
 *
 * **No toca las asignaciones usuario↔rol.**
 *
 * MariaDB no se respalda solo: exige `ROLES_GLOBAL_BACKUP_PATH` apuntando a un
 * dump previo, igual que las demás migraciones remotas.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  sembrarRolesDelProducto,
  huellaDelCatalogo,
} from "../../shared/catalogos/roles-producto";

async function migrar() {
  const respaldo = process.env.ROLES_GLOBAL_BACKUP_PATH;
  if (!respaldo || !existsSync(resolve(respaldo))) {
    throw new Error(
      "Defina ROLES_GLOBAL_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  console.log(`Respaldo declarado: ${respaldo}`);

  const asignacionesAntes = (
    await prisma.$queryRawUnsafe<any[]>("SELECT COUNT(*) AS n FROM `_RoleToUser`")
  )[0];

  const resultado = await sembrarRolesDelProducto(prisma);

  const repetidos = await prisma.$queryRawUnsafe<any[]>(
    "SELECT name, COUNT(*) AS n FROM roles WHERE is_deleted = 0 GROUP BY name HAVING COUNT(*) > 1",
  );
  if (repetidos.length) {
    throw new Error(
      `Hay roles con el mismo nombre: ${repetidos.map((r) => r.name).join(", ")}. ` +
        "La opción A exige que el nombre identifique al rol.",
    );
  }

  const asignacionesDespues = (
    await prisma.$queryRawUnsafe<any[]>("SELECT COUNT(*) AS n FROM `_RoleToUser`")
  )[0];
  if (Number(asignacionesAntes.n) !== Number(asignacionesDespues.n)) {
    throw new Error(
      `La migración cambió las asignaciones usuario↔rol (${asignacionesAntes.n} → ` +
        `${asignacionesDespues.n}). No debe tocarlas.`,
    );
  }

  const huella = await huellaDelCatalogo(prisma);
  console.log(
    `Migración remota de roles lista · roles ${resultado.roles} · permisos ` +
      `${resultado.permisos} · filas normalizadas ${resultado.normalizados} · ` +
      `asignaciones intactas ${asignacionesDespues.n}`,
  );
  console.log(`Huella del catálogo: ${huella.huella}`);
  console.log(`Filas con gym_id no nulo: ${huella.conSede} (debe ser 0)`);
}

try {
  await migrar();
} finally {
  await prisma.$disconnect();
}
