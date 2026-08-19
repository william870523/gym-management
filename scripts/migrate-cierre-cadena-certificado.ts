/**
 * M6 — certificado del consolidado de la cadena (MariaDB). Gemela de la de
 * `gym-local-api`. Diseño: docs/MULTI_SEDE.md §6.4.
 *
 * ## Qué guarda, y por qué no basta con el informe
 *
 * §6.4 separa el **informe agregado** —que se mira cuando se quiera y cambia si
 * llegan datos nuevos— del **certificado**, que congela una copia exacta de lo
 * que había y ya no cambia aunque después entren correcciones. Esta tabla es lo
 * segundo: la foto y su sello.
 *
 * La foto se guarda como **texto**, no como campos sueltos, y junto a su
 * `sha256`. Reconstruirla desde columnas para verificarla mediría la
 * serialización de hoy y no la firma de entonces; guardar el texto exacto es lo
 * único que demuestra que nadie la tocó. Va en `LONGTEXT` porque la foto lleva el
 * desglose de todas las sedes y todas sus monedas.
 *
 * ## Por qué no lleva `gym_id`
 *
 * El certificado es de la cadena entera, igual que la solicitud de cierre, y
 * tiene que llegar a **todas** las instalaciones: la sede tiene derecho a ver la
 * foto contable en la que entró, y la paridad de datos exige que el dato esté en
 * las dos bases.
 *
 * ## Identidad derivada, y ciclo para poder rehacerlo
 *
 * `certificado_id` sale del período y del ciclo. Firmar dos veces el mismo
 * período **no** pisa el anterior: se emite el ciclo siguiente y el viejo se
 * conserva, porque «esto es lo que se cerró en julio» tiene que seguir siendo
 * cierto aunque después se firmara una corrección. `clave_activa` deja uno solo
 * vigente por período.
 *
 * Uso:
 *   CIERRE_CADENA_BACKUP_PATH=/ruta/dump.sql bun scripts/migrate-cierre-cadena-certificado.ts
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNAS = new Set([
  "certificado_id", "clave_activa", "tipo_periodo", "fecha_inicio",
  "fecha_fin_exclusiva", "ciclo_numero", "clase", "estado",
  "sedes_incluidas", "foto_json", "foto_sha256", "foto_version",
  "firmado_por_user_id", "firmado_por_nombre_snapshot",
  "firmado_por_rol_snapshot", "firmado_at", "anulado_motivo", "anulado_at",
  "source_device", "version", "is_deleted", "created_at", "updated_at",
  "deleted_at",
]);

async function backupMariadb() {
  const ruta = process.env.CIERRE_CADENA_BACKUP_PATH;
  if (!ruta || !existsSync(resolve(ruta)) || statSync(resolve(ruta)).size <= 0) {
    throw new Error(
      "Defina CIERRE_CADENA_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }
  console.log(`Respaldo MariaDB verificado: ${resolve(ruta)}`);
  return resolve(ruta);
}

const columnas = () =>
  prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE " +
      "TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cierre_cadena_certificado'",
  );

try {
  const backup = await backupMariadb();
  if ((await columnas()).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE cierre_cadena_certificado (
        certificado_id VARCHAR(191) NOT NULL,
        clave_activa VARCHAR(191) NULL,
        tipo_periodo VARCHAR(191) NOT NULL,
        fecha_inicio DATETIME(3) NOT NULL,
        fecha_fin_exclusiva DATETIME(3) NOT NULL,
        ciclo_numero INT NOT NULL DEFAULT 1,
        clase VARCHAR(191) NOT NULL,
        estado VARCHAR(191) NOT NULL,
        sedes_incluidas INT NOT NULL DEFAULT 0,
        foto_json LONGTEXT NOT NULL,
        foto_sha256 VARCHAR(191) NOT NULL,
        foto_version INT NOT NULL DEFAULT 1,
        firmado_por_user_id VARCHAR(191) NOT NULL,
        firmado_por_nombre_snapshot VARCHAR(191) NOT NULL,
        firmado_por_rol_snapshot VARCHAR(191) NOT NULL,
        firmado_at DATETIME(3) NOT NULL,
        anulado_motivo TEXT NULL,
        anulado_at DATETIME(3) NULL,
        source_device VARCHAR(191) NULL,
        version INT NOT NULL DEFAULT 1,
        is_deleted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (certificado_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Un solo certificado vigente por período. El histórico se conserva: los
    // anulados sueltan la clave y siguen ahí, porque «esto es lo que se cerró en
    // julio» tiene que poder demostrarse aunque después se firmara otra cosa.
    await prisma.$executeRawUnsafe(
      "CREATE UNIQUE INDEX uq_cierre_cadena_cert_activa ON cierre_cadena_certificado (clave_activa)",
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX idx_cierre_cadena_cert_periodo ON cierre_cadena_certificado " +
        "(tipo_periodo, fecha_inicio, fecha_fin_exclusiva)",
    );
    console.log("Tabla `cierre_cadena_certificado` creada.");
  } else {
    console.log("La tabla ya existía; no se recrea.");
  }

  const presentes = new Set((await columnas()).map((c) => c.COLUMN_NAME));
  const faltan = [...COLUMNAS].filter((c) => !presentes.has(c));
  if (faltan.length > 0) {
    throw new Error(`Faltan columnas tras migrar: ${faltan.join(", ")}`);
  }
  const [{ filas }] = await prisma.$queryRawUnsafe<Array<{ filas: bigint }>>(
    "SELECT COUNT(*) AS filas FROM cierre_cadena_certificado",
  );
  console.log(
    `OK · ${presentes.size} columnas · ${Number(filas)} certificados · respaldo ${backup}`,
  );
} finally {
  await prisma.$disconnect();
}
