/**
 * Migración aditiva e idempotente de gastos devengados gobernados (R4.6).
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 * Crea las cuatro tablas del dominio y siembra las seis categorías base por
 * gimnasio existente.
 */
import { existsSync } from "fs";
import { createHash } from "crypto";
import { prisma } from "../src/infrastructure/db/prismaClient";

const SYSTEM_CATEGORIES: ReadonlyArray<{ nombre: string; naturaleza: string }> = [
  { nombre: "Alquiler", naturaleza: "OPERATIVO" },
  { nombre: "Electricidad", naturaleza: "OPERATIVO" },
  { nombre: "Agua", naturaleza: "OPERATIVO" },
  { nombre: "Limpieza", naturaleza: "OPERATIVO" },
  { nombre: "Mantenimiento", naturaleza: "OPERATIVO" },
  { nombre: "Proveedores", naturaleza: "COSTO_VENTAS" },
  { nombre: "Otros", naturaleza: "ADMINISTRATIVO" },
];

function categoryId(gymId: string, nombre: string) {
  return `gcat-${createHash("sha256").update(`${gymId}|${nombre}`).digest("hex").slice(0, 24)}`;
}

async function migrate() {
  const backupPath = process.env.GOVERNED_EXPENSE_BACKUP_PATH;
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      "Defina GOVERNED_EXPENSE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gasto_categoria (
      categoria_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      nombre VARCHAR(191) NOT NULL,
      naturaleza VARCHAR(32) NOT NULL DEFAULT 'OPERATIVO',
      es_sistema BOOLEAN NOT NULL DEFAULT false,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (categoria_id),
      UNIQUE KEY uq_gasto_categoria_nombre (gym_id, nombre),
      KEY idx_gasto_categoria_naturaleza (gym_id, naturaleza)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gasto_proveedor (
      proveedor_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      nombre VARCHAR(191) NOT NULL,
      documento VARCHAR(191) NULL,
      cuenta_pago_default_id VARCHAR(191) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (proveedor_id),
      UNIQUE KEY uq_gasto_proveedor_documento (gym_id, documento),
      KEY idx_gasto_proveedor_nombre (gym_id, nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gasto_gobernado (
      gasto_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      categoria_id VARCHAR(191) NOT NULL,
      proveedor_id VARCHAR(191) NULL,
      moneda_id VARCHAR(191) NOT NULL,
      descripcion VARCHAR(500) NOT NULL,
      monto DECIMAL(18,2) NOT NULL,
      periodo_pertenencia_mes VARCHAR(7) NOT NULL,
      fecha_pago DATETIME(3) NULL,
      fecha_programada DATETIME(3) NOT NULL,
      metodo_devengo VARCHAR(32) NOT NULL DEFAULT 'MES_PERTENENCIA',
      estado VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE',
      pagado_acumulado DECIMAL(18,2) NOT NULL DEFAULT 0,
      comprobante_referencia VARCHAR(191) NULL,
      registrada_por_user_id VARCHAR(191) NOT NULL,
      formula_snapshot_json LONGTEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (gasto_id),
      KEY idx_gasto_mes_estado (gym_id, periodo_pertenencia_mes, estado),
      KEY idx_gasto_categoria (gym_id, categoria_id),
      KEY idx_gasto_proveedor (gym_id, proveedor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gasto_gobernado_aplicacion (
      aplicacion_id VARCHAR(191) NOT NULL,
      gasto_id VARCHAR(191) NOT NULL,
      movimiento_id VARCHAR(191) NOT NULL,
      monto_aplicado DECIMAL(18,2) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'APLICADA',
      aplicada_at DATETIME(3) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (aplicacion_id),
      UNIQUE KEY uq_gasto_aplicacion_mov (gasto_id, movimiento_id),
      KEY idx_gasto_aplicacion_estado (gasto_id, estado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Seed de categorías base por gimnasio. Idempotente.
  const gyms = await prisma.gym.findMany({ select: { gym_id: true } });
  let seeded = 0;
  for (const gym of gyms) {
    for (const cat of SYSTEM_CATEGORIES) {
      const exists = await prisma.gastoCategoria.findFirst({
        where: { gym_id: gym.gym_id, nombre: cat.nombre },
        select: { categoria_id: true },
      });
      if (exists) continue;
      await prisma.gastoCategoria.create({
        data: {
          categoria_id: categoryId(gym.gym_id, cat.nombre),
          gym_id: gym.gym_id,
          nombre: cat.nombre,
          naturaleza: cat.naturaleza,
          es_sistema: true,
        },
      });
      seeded += 1;
    }
  }

  const [catCount, provCount, expenseCount, appCount] = await Promise.all([
    prisma.gastoCategoria.count(),
    prisma.gastoProveedor.count(),
    prisma.gastoGobernado.count(),
    prisma.gastoGobernadoAplicacion.count(),
  ]);
  console.log(
    `Migración remota lista; categorías sembradas: ${seeded}. ` +
      `Totales → categorías: ${catCount}, proveedores: ${provCount}, ` +
      `gastos: ${expenseCount}, aplicaciones: ${appCount}.`,
  );
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
