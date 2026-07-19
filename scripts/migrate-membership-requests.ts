import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS membresia_solicitud (
      solicitud_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      ci VARCHAR(191) NOT NULL,
      tipo VARCHAR(32) NOT NULL,
      motivo TEXT NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE',
      pendiente_clave VARCHAR(191) NULL,
      fecha_efectiva_solicitada DATETIME(3) NOT NULL,
      fecha_efectiva_aplicada DATETIME(3) NULL,
      dias_restantes_estimados INT NOT NULL,
      dias_restantes_aplicados INT NULL,
      fecha_fin_estimada DATETIME(3) NULL,
      fecha_fin_resultante DATETIME(3) NULL,
      solicitada_por_user_id VARCHAR(191) NOT NULL,
      solicitada_por_nombre_snapshot VARCHAR(191) NOT NULL,
      solicitada_at DATETIME(3) NOT NULL,
      decidida_por_user_id VARCHAR(191) NULL,
      decidida_por_nombre_snapshot VARCHAR(191) NULL,
      decision_motivo TEXT NULL,
      decision_operacion_id VARCHAR(191) NULL,
      decidida_at DATETIME(3) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (solicitud_id),
      UNIQUE KEY uq_memb_sol_pendiente (pendiente_clave),
      UNIQUE KEY uq_memb_sol_decision_op (decision_operacion_id),
      KEY idx_memb_sol_gym_estado_fecha (gym_id, estado, solicitada_at),
      KEY idx_memb_sol_memb_estado (membresia_id, estado),
      KEY idx_memb_sol_ci_estado_fecha (ci, estado, solicitada_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM membresia_solicitud",
  );
  console.log(
    `Migración remota de solicitudes lista; registros existentes: ${Number(count[0]?.total ?? 0)}.`,
  );
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
