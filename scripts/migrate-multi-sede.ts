/**
 * Multi-sede M1 — autoridad de plataforma y contexto de sede
 * (docs/MULTI_SEDE.md §3 y §8).
 *
 * Gemela de la migración local: mismas dos piezas y mismo relleno.
 *
 *   1. `User.es_plataforma` — el nivel de **Dueño de la cadena**, por encima de
 *      administración. Nace en `false` para todos: no se le regala a nadie.
 *   2. `usuario_sede` — quién puede trabajar en qué sede y con qué puesto.
 *   3. Relleno: cada usuario vigente que hoy tenga `gym_id` recibe su fila con
 *      el puesto que ya tiene, para que nadie se quede fuera (§7.4).
 *
 * Exige un dump MariaDB verificable creado antes de ejecutarla.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { usuarioSedeId } from "../src/application/auth/usuario-sede";

async function columnsOf(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function tableExists(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM information_schema.TABLES " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function addPlatformColumn() {
  const existed = (await columnsOf("User")).has("es_plataforma");
  await prisma.$executeRawUnsafe(
    "ALTER TABLE User ADD COLUMN IF NOT EXISTS es_plataforma TINYINT(1) NOT NULL DEFAULT 0",
  );
  console.log(
    `User.es_plataforma: ${existed ? "ya existía" : "añadida (todos en false)"}.`,
  );
}

/**
 * La colación se fija a mano a propósito. MariaDB 11 crea las tablas nuevas con
 * `utf8mb4_uca1400_ai_ci`, mientras que todo el esquema existente es
 * `utf8mb4_unicode_ci`; con las dos conviviendo, un `JOIN` de `usuario_sede`
 * contra `User` revienta con «Illegal mix of collations». Si la tabla ya
 * existiera con la colación equivocada se convierte, sin perder filas.
 */
const COLACION = "utf8mb4_unicode_ci";

async function createUsuarioSede() {
  const existed = await tableExists("usuario_sede");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS usuario_sede (
      usuario_sede_id VARCHAR(191) NOT NULL PRIMARY KEY,
      user_id         VARCHAR(191) NOT NULL,
      gym_id          VARCHAR(191) NOT NULL,
      rol             VARCHAR(80)  NOT NULL,
      activo          TINYINT(1)   NOT NULL DEFAULT 1,
      source_device   VARCHAR(191) NULL,
      version         INT          NOT NULL DEFAULT 1,
      is_deleted      TINYINT(1)   NOT NULL DEFAULT 0,
      created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at      DATETIME(3)  NULL,
      UNIQUE KEY idx_usuario_sede_user_gym (user_id, gym_id),
      KEY idx_usuario_sede_gym_activo (gym_id, activo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLACION}
  `);

  const actual = await prisma.$queryRawUnsafe<Array<{ TABLE_COLLATION: string }>>(
    "SELECT TABLE_COLLATION FROM information_schema.TABLES " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuario_sede'",
  );
  const colacionActual = actual[0]?.TABLE_COLLATION;
  if (colacionActual && colacionActual !== COLACION) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE usuario_sede CONVERT TO CHARACTER SET utf8mb4 COLLATE ${COLACION}`,
    );
    console.log(
      `usuario_sede: colación corregida de ${colacionActual} a ${COLACION}.`,
    );
  }
  console.log(`usuario_sede: ${existed ? "ya existía" : "creada"} · ${COLACION}.`);
}

async function backfill() {
  const usuarios = await prisma.$queryRawUnsafe<
    Array<{ user_id: string; gym_id: string | null; role: string; active: number }>
  >(
    "SELECT user_id, gym_id, role, active FROM User WHERE is_deleted = 0",
  );

  const conSede = usuarios.filter((u) => u.gym_id && u.gym_id.trim().length > 0);
  const sinSede = usuarios.filter((u) => !u.gym_id || !u.gym_id.trim().length);
  const ahora = trustedClock.nowUtc();

  let creadas = 0;
  for (const usuario of conSede) {
    const id = usuarioSedeId(usuario.user_id, usuario.gym_id!);
    // No se pisa una fila existente: si el dueño ya cambió el puesto de alguien
    // en una sede, el relleno no debe devolverlo al valor antiguo.
    const afectadas = await prisma.$executeRawUnsafe(
      "INSERT IGNORE INTO usuario_sede " +
        "(usuario_sede_id, user_id, gym_id, rol, activo, version, is_deleted, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)",
      id,
      usuario.user_id,
      usuario.gym_id,
      usuario.role,
      usuario.active ? 1 : 0,
      ahora,
      ahora,
    );
    creadas += Number(afectadas);
  }

  console.log(
    `Membresías: ${creadas} creada(s) de ${conSede.length} usuario(s) con sede ` +
      `(el resto ya estaba).`,
  );
  if (sinSede.length) {
    console.log(
      `AVISO: ${sinSede.length} usuario(s) vigente(s) sin gym_id no reciben ` +
        "membresía; su sede la decide el dueño desde la aplicación: " +
        sinSede.map((u) => u.user_id).join(", "),
    );
  }
}

async function verify() {
  if (!(await columnsOf("User")).has("es_plataforma")) {
    throw new Error("La migración no dejó User.es_plataforma.");
  }
  if (!(await tableExists("usuario_sede"))) {
    throw new Error("La migración no dejó la tabla usuario_sede.");
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM usuario_sede WHERE is_deleted = 0",
  );
  const duenos = await prisma.$queryRawUnsafe<Array<{ duenos: bigint }>>(
    "SELECT COUNT(*) AS duenos FROM User WHERE es_plataforma = 1 AND is_deleted = 0",
  );
  const huerfanas = await prisma.$queryRawUnsafe<Array<{ usuario_sede_id: string }>>(
    "SELECT us.usuario_sede_id FROM usuario_sede us " +
      "LEFT JOIN User u ON u.user_id = us.user_id " +
      "WHERE u.user_id IS NULL",
  );
  if (huerfanas.length) {
    throw new Error(
      `usuario_sede tiene ${huerfanas.length} fila(s) sin usuario: ` +
        huerfanas.map((f) => f.usuario_sede_id).join(", "),
    );
  }
  console.log(
    `Membresías vigentes: ${Number(rows[0]?.total ?? 0)} · dueños de la cadena: ` +
      `${Number(duenos[0]?.duenos ?? 0)}.`,
  );
}

async function migrate() {
  const backupPath = process.env.MULTI_SEDE_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina MULTI_SEDE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await addPlatformColumn();
  await createUsuarioSede();
  await backfill();
  await verify();
  console.log("Migración remota de multi-sede M1 lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
