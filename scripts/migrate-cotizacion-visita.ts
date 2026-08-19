/**
 * M4c — cotización de visita (MariaDB). Gemela de la de `gym-local-api`.
 *
 * Crea la tabla y **no proyecta ninguna cotización**, por la misma razón que su
 * gemela: proyectarlas aquí sería fabricar precios sin pasar por el productor,
 * que es quien sabe resolver el descuento de cada socio contra la configuración
 * de su sede.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNAS = new Set([
  "ci", "gym_id_origen", "plan_id", "plan_codigo", "plan_nombre", "moneda_id",
  "precio_lista", "precio_final", "categoria_cliente", "cubre_hasta",
  "mora_activo", "mora_modo", "mora_valor", "mora_tope", "cuota_numero",
  "cuota_importe", "cuota_fecha_exigible", "calculada_al", "source_device",
  "version", "is_deleted", "created_at", "updated_at", "deleted_at",
]);

async function backupMariadb() {
  const ruta = process.env.COTIZACION_VISITA_BACKUP_PATH;
  if (!ruta || !existsSync(resolve(ruta)) || statSync(resolve(ruta)).size <= 0) {
    throw new Error(
      "Defina COTIZACION_VISITA_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }
  console.log(`Respaldo MariaDB verificado: ${resolve(ruta)}`);
  return resolve(ruta);
}

const columnas = () =>
  prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE " +
      "TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cliente_visitante_cotizacion'",
  );

try {
  const backup = await backupMariadb();
  if ((await columnas()).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE cliente_visitante_cotizacion (
        ci VARCHAR(191) NOT NULL,
        gym_id_origen VARCHAR(191) NOT NULL,
        plan_id VARCHAR(191) NOT NULL,
        plan_codigo VARCHAR(191) NOT NULL,
        plan_nombre VARCHAR(191) NOT NULL,
        moneda_id VARCHAR(191) NOT NULL,
        precio_lista DECIMAL(65,30) NOT NULL,
        precio_final DECIMAL(65,30) NOT NULL,
        categoria_cliente VARCHAR(191) NOT NULL,
        cubre_hasta DATETIME(3) NULL,
        mora_activo TINYINT(1) NOT NULL DEFAULT 0,
        mora_modo VARCHAR(191) NULL,
        mora_valor VARCHAR(191) NULL,
        mora_tope VARCHAR(191) NULL,
        cuota_numero INT NULL,
        cuota_importe DECIMAL(65,30) NULL,
        cuota_fecha_exigible DATETIME(3) NULL,
        calculada_al DATETIME(3) NOT NULL,
        source_device VARCHAR(191) NULL,
        version INT NOT NULL DEFAULT 1,
        is_deleted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (ci),
        KEY idx_visitante_cotizacion_origen (gym_id_origen, is_deleted)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabla cliente_visitante_cotizacion creada.");
  } else {
    console.log("Tabla cliente_visitante_cotizacion ya existía; solo se verifica.");
  }
  const nombres = new Set((await columnas()).map((c) => c.COLUMN_NAME));
  const faltan = [...COLUMNAS].filter((n) => !nombres.has(n));
  if (faltan.length) {
    throw new Error(`Esquema M4c incompleto; faltan: ${faltan.join(", ")}`);
  }
  const [{ total }] = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM cliente_visitante_cotizacion",
  );
  console.log(`Migración lista. Cotizaciones: ${Number(total)}. Respaldo: ${backup}`);
} finally {
  await prisma.$disconnect();
}
