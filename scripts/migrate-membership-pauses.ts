import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS membresia_pausa (
      pausa_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      fecha_pausa DATETIME(3) NOT NULL,
      fecha_reanudacion DATETIME(3) NULL,
      fecha_fin_anterior DATETIME(3) NOT NULL,
      fecha_fin_recalculada DATETIME(3) NULL,
      dias_restantes_snapshot INT NOT NULL,
      motivo TEXT NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'ACTIVA',
      activa_clave VARCHAR(191) NULL,
      pausada_at DATETIME(3) NOT NULL,
      reanudada_at DATETIME(3) NULL,
      registrada_por_user_id VARCHAR(191) NULL,
      reanudada_por_user_id VARCHAR(191) NULL,
      reanudacion_operacion_id VARCHAR(191) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (pausa_id),
      UNIQUE KEY uq_memb_pausa_activa (activa_clave),
      UNIQUE KEY uq_memb_pausa_resume_op (reanudacion_operacion_id),
      KEY idx_memb_pausa_memb_estado (membresia_id, estado),
      KEY idx_memb_pausa_gym_estado_fecha (gym_id, estado, fecha_pausa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM membresia_pausa",
  );
  console.log(
    `Migración de pausas remota lista; intervalos existentes: ${Number(count[0]?.total ?? 0)}.`,
  );
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
