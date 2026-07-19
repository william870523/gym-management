/**
 * Migración aditiva e idempotente de membresías para MariaDB.
 *
 * IMPORTANTE: crear un backup verificado con mariadb-dump/mysqldump antes de
 * ejecutar en una base con datos. Este script no intenta conocer credenciales
 * ni automatizar el respaldo del servidor.
 *
 * Uso: bun run migrate:memberships-phase1
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { createHash, randomUUID } from "crypto";
import { serialize } from "../src/shared/utils/serialize";

function deterministicUuid(scope: string): string {
  const chars = createHash("sha256")
    .update(scope)
    .digest("hex")
    .slice(0, 32)
    .split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

try {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS membresia_cliente (
      membresia_id VARCHAR(191) NOT NULL,
      ci VARCHAR(191) NOT NULL,
      id_planes_pago VARCHAR(191) NOT NULL,
      id_entrenador VARCHAR(191) NULL,
      plan_nombre_snapshot VARCHAR(191) NOT NULL,
      precio_snapshot DECIMAL(18,2) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      duracion_dias_snapshot INT NOT NULL,
      fecha_inicio DATETIME(3) NOT NULL,
      fecha_fin DATETIME(3) NOT NULL,
      estado VARCHAR(64) NOT NULL DEFAULT 'PENDIENTE_PAGO',
      origen VARCHAR(64) NOT NULL DEFAULT 'ALTA',
      importe_pagado DECIMAL(18,2) NOT NULL DEFAULT 0,
      activada_at DATETIME(3) NULL,
      reconstruida BOOLEAN NOT NULL DEFAULT FALSE,
      confianza_reconstruccion VARCHAR(64) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (membresia_id),
      INDEX idx_memb_cliente_ci_estado_fin (ci, estado, fecha_fin),
      INDEX idx_memb_cliente_gym_estado_fin (gym_id, estado, fecha_fin),
      INDEX idx_memb_cliente_plan_estado (id_planes_pago, estado)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS membresia_entrenador_asignacion (
      asignacion_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      id_entrenador VARCHAR(191) NOT NULL,
      fecha_inicio DATETIME(3) NOT NULL,
      fecha_fin DATETIME(3) NULL,
      estado VARCHAR(64) NOT NULL DEFAULT 'PENDIENTE',
      motivo_cierre VARCHAR(191) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (asignacion_id),
      INDEX idx_memb_asig_memb_estado (membresia_id, estado),
      INDEX idx_memb_asig_ent_estado_inicio (id_entrenador, estado, fecha_inicio)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pago_membresia_aplicacion (
      aplicacion_id VARCHAR(191) NOT NULL,
      pago_cliente_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      monto_aplicado DECIMAL(18,2) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (aplicacion_id),
      UNIQUE KEY uq_pago_memb_pago_memb (pago_cliente_id, membresia_id),
      INDEX idx_pago_memb_memb_deleted (membresia_id, is_deleted)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  const insertedMemberships = await prisma.$executeRawUnsafe(`
    INSERT INTO membresia_cliente (
      membresia_id, ci, id_planes_pago, id_entrenador,
      plan_nombre_snapshot, precio_snapshot, moneda_id,
      duracion_dias_snapshot, fecha_inicio, fecha_fin, estado, origen,
      importe_pagado, reconstruida, confianza_reconstruccion, is_deleted,
      created_at, gym_id, source_device, version, updated_at
    )
    SELECT
      UUID(), c.ci, c.id_planes_pago, c.id_entrenador,
      COALESCE(p.nombre_plan_pago, p.id_planes_pago), p.importe_plan_pago,
      p.moneda_id, p.duracion_plan_pago, c.fecha_inicio, c.fecha_fin,
      CASE WHEN c.activo = TRUE THEN 'ACTIVA' ELSE 'VENCIDA' END,
      'MIGRACION_ESTADO_ACTUAL', 0, TRUE, 'ESTADO_ACTUAL', FALSE,
      COALESCE(c.created_at, UTC_TIMESTAMP(3)), c.gym_id, c.source_device, 1,
      COALESCE(c.updated_at, UTC_TIMESTAMP(3))
    FROM cliente c
    JOIN planes_pago p ON p.id_planes_pago = c.id_planes_pago
    WHERE c.id_planes_pago IS NOT NULL
      AND c.gym_id IS NOT NULL
      AND c.is_deleted = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM membresia_cliente m
        WHERE m.ci = c.ci AND m.gym_id = c.gym_id
          AND m.origen = 'MIGRACION_ESTADO_ACTUAL'
      )
  `);

  const insertedAssignments = await prisma.$executeRawUnsafe(`
    INSERT INTO membresia_entrenador_asignacion (
      asignacion_id, membresia_id, id_entrenador, fecha_inicio, fecha_fin,
      estado, motivo_cierre, is_deleted, created_at, gym_id, source_device,
      version, updated_at
    )
    SELECT
      UUID(), m.membresia_id, m.id_entrenador, m.fecha_inicio,
      CASE WHEN m.estado = 'ACTIVA' THEN NULL ELSE m.fecha_fin END,
      CASE WHEN m.estado = 'ACTIVA' THEN 'ACTIVA' ELSE 'CERRADA' END,
      CASE WHEN m.estado = 'ACTIVA' THEN NULL ELSE 'MIGRACION_ESTADO_ACTUAL' END,
      FALSE, m.created_at, m.gym_id, m.source_device, 1, m.updated_at
    FROM membresia_cliente m
    WHERE m.id_entrenador IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM membresia_entrenador_asignacion a
        WHERE a.membresia_id = m.membresia_id
      )
  `);

  await prisma.syncLog.deleteMany({
    where: {
      device_id: "MIGRATION_PHASE1",
      entidad: {
        in: ["membresia_cliente", "membresia_entrenador_asignacion"],
      },
    },
  });

  let reconstructedMemberships = await prisma.membresiaCliente.findMany({
    where: { origen: "MIGRACION_ESTADO_ACTUAL" },
  });
  for (const membership of reconstructedMemberships) {
    const canonicalId = deterministicUuid(
      `gymos:membresia-actual:${membership.gym_id}:${membership.ci}`,
    );
    if (membership.membresia_id === canonicalId) continue;
    const hasApplications = await prisma.pagoMembresiaAplicacion.count({
      where: { membresia_id: membership.membresia_id },
    });
    if (hasApplications > 0) continue;
    await prisma.$transaction([
      prisma.membresiaEntrenadorAsignacion.updateMany({
        where: { membresia_id: membership.membresia_id },
        data: { membresia_id: canonicalId },
      }),
      prisma.membresiaCliente.update({
        where: { membresia_id: membership.membresia_id },
        data: { membresia_id: canonicalId },
      }),
    ]);
  }
  reconstructedMemberships = await prisma.membresiaCliente.findMany({
    where: { origen: "MIGRACION_ESTADO_ACTUAL" },
  });
  let reconstructedAssignments =
    await prisma.membresiaEntrenadorAsignacion.findMany({
      where: {
        membresia_id: {
          in: reconstructedMemberships.map((membership) => membership.membresia_id),
        },
      },
    });
  for (const assignment of reconstructedAssignments) {
    const canonicalId = deterministicUuid(
      `gymos:asignacion-actual:${assignment.gym_id}:${assignment.membresia_id}:${assignment.id_entrenador}`,
    );
    if (assignment.asignacion_id === canonicalId) continue;
    await prisma.membresiaEntrenadorAsignacion.update({
      where: { asignacion_id: assignment.asignacion_id },
      data: { asignacion_id: canonicalId },
    });
  }
  reconstructedAssignments = await prisma.membresiaEntrenadorAsignacion.findMany({
    where: {
      membresia_id: {
        in: reconstructedMemberships.map((membership) => membership.membresia_id),
      },
    },
  });

  let logged = 0;
  for (const [entity, id, gymId, record] of [
    ...reconstructedMemberships.map((record) => [
      "membresia_cliente",
      record.membresia_id,
      record.gym_id,
      record,
    ] as const),
    ...reconstructedAssignments.map((record) => [
      "membresia_entrenador_asignacion",
      record.asignacion_id,
      record.gym_id,
      record,
    ] as const),
  ]) {
    const exists = await prisma.syncLog.findFirst({
      where: { entidad: entity, entidad_id: id, gym_id: gymId },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.syncLog.create({
      data: {
        event_id: randomUUID(),
        entidad: entity,
        operacion: "INSERT",
        entidad_id: id,
        gym_id: gymId,
        device_id: "MIGRATION_PHASE1",
        payload_json: JSON.stringify(serialize(record)),
      },
    });
    logged++;
  }

  console.log(
    `Migración lista: ${insertedMemberships} membresía(s), ${insertedAssignments} asignación(es) reconstruidas y ${logged} evento(s) registrados.`,
  );
} finally {
  await prisma.$disconnect();
}
