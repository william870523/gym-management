/**
 * Migración aditiva e idempotente — recargo por mora (docs/RECARGO_MORA.md).
 *
 * Añade la configuración por plan en `planes_pago` y el snapshot congelado en
 * `detalle_pago`. Exige un dump MariaDB verificable creado antes de ejecutarla
 * (RECARGO_MORA_BACKUP_PATH). Segunda ejecución = no-op.
 */
import { existsSync } from "fs";
import { prisma } from "../src/infrastructure/db/prismaClient";

const PLAN_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "recargo_mora_modo", ddl: "recargo_mora_modo VARCHAR(191) NULL" },
  { name: "recargo_mora_valor", ddl: "recargo_mora_valor VARCHAR(191) NULL" },
  { name: "recargo_mora_tope", ddl: "recargo_mora_tope VARCHAR(191) NULL" },
  { name: "recargo_mora_activo", ddl: "recargo_mora_activo TINYINT(1) NOT NULL DEFAULT 0" },
];

const PAGO_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "recargo_mora_condonado_importe", ddl: "recargo_mora_condonado_importe VARCHAR(191) NULL" },
  { name: "recargo_mora_condonado_motivo", ddl: "recargo_mora_condonado_motivo VARCHAR(500) NULL" },
  { name: "recargo_mora_condonado_por", ddl: "recargo_mora_condonado_por VARCHAR(191) NULL" },
];

const DETALLE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "recargo_mora_modo_snapshot", ddl: "recargo_mora_modo_snapshot VARCHAR(191) NULL" },
  { name: "recargo_mora_dias_atraso", ddl: "recargo_mora_dias_atraso INT NULL" },
  { name: "recargo_mora_base", ddl: "recargo_mora_base VARCHAR(191) NULL" },
  { name: "recargo_mora_importe", ddl: "recargo_mora_importe VARCHAR(191) NULL" },
  { name: "recargo_mora_plan_valor", ddl: "recargo_mora_plan_valor VARCHAR(191) NULL" },
  { name: "recargo_mora_plan_tope", ddl: "recargo_mora_plan_tope VARCHAR(191) NULL" },
];

async function existingColumns(table: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    table,
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

async function addMissing(table: string, cols: typeof PLAN_COLUMNS): Promise<number> {
  const present = await existingColumns(table);
  let added = 0;
  for (const col of cols) {
    if (present.has(col.name)) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN ${col.ddl}`);
    added++;
  }
  return added;
}

async function migrate() {
  const planPresent = await existingColumns("planes_pago");
  const detallePresent = await existingColumns("detalle_pago");
  const pagoPresent = await existingColumns("pago_cliente");
  const planNeeds = PLAN_COLUMNS.some((c) => !planPresent.has(c.name));
  const detalleNeeds = DETALLE_COLUMNS.some((c) => !detallePresent.has(c.name));
  const pagoNeeds = PAGO_COLUMNS.some((c) => !pagoPresent.has(c.name));

  if (!planNeeds && !detalleNeeds && !pagoNeeds) {
    console.log("Migración remota ya aplicada: columnas de recargo por mora presentes.");
    return;
  }

  const backupPath = process.env.RECARGO_MORA_BACKUP_PATH;
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      "Defina RECARGO_MORA_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }

  const a = await addMissing("planes_pago", PLAN_COLUMNS);
  const b = await addMissing("detalle_pago", DETALLE_COLUMNS);
  const c2 = await addMissing("pago_cliente", PAGO_COLUMNS);
  console.log(`Migración remota lista: planes_pago +${a}, detalle_pago +${b}, pago_cliente +${c2} columnas.`);

  const p = await existingColumns("planes_pago");
  const d = await existingColumns("detalle_pago");
  const missP = PLAN_COLUMNS.filter((c) => !p.has(c.name)).map((c) => c.name);
  const missD = DETALLE_COLUMNS.filter((c) => !d.has(c.name)).map((c) => c.name);
  const pg = await existingColumns("pago_cliente");
  const missPg = PAGO_COLUMNS.filter((c) => !pg.has(c.name)).map((c) => c.name);
  if (missP.length || missD.length || missPg.length) {
    throw new Error(`Faltan columnas tras migrar: ${[...missP, ...missD, ...missPg].join(", ")}`);
  }
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
