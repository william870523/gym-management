/**
 * M5 — solicitud de cierre de la cadena (MariaDB). Gemela de la de
 * `gym-local-api`. Diseño: docs/MULTI_SEDE.md §6.2.
 *
 * ## Qué es, y qué NO es
 *
 * Contabilidad central **pide** que se cierre un período; cada sede lo ejecuta y
 * lo firma con su arqueo, porque el dinero está allí. Esta tabla guarda la
 * petición, no el cierre.
 *
 * **No confundir con `tesoreria_cierre_solicitud`**, que ya existe y es otra
 * cosa: la aprobación interna de un arqueo que salió descuadrado, dentro de una
 * sede. Se parecen en el nombre y no se tocan en nada; por eso esta se llama
 * «de cadena».
 *
 * ## Por qué no lleva `gym_id`
 *
 * La solicitud es **una para toda la cadena** y tiene que llegar a **todas** las
 * instalaciones, como el precio del plus multi-sede o los catálogos globales. Si
 * llevara sede habría que emitir una por sede y mantenerlas coherentes entre
 * ellas; con una sola, el semáforo compara todas las sedes contra la misma
 * petición, que es justo lo que hace comparable el consolidado.
 *
 * La sede a la que se le reclama no sale de aquí: sale de cruzar esta solicitud
 * con los cierres firmados que hayan llegado (`semaforo-cierre-policy`).
 *
 * Uso:
 *   CIERRE_CADENA_BACKUP_PATH=/ruta/dump.sql bun scripts/migrate-cierre-cadena-solicitud.ts
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNAS = new Set([
  "solicitud_id", "tipo_periodo", "fecha_inicio", "fecha_fin_exclusiva",
  "estado", "nota", "fecha_limite", "solicitada_por_user_id",
  "solicitada_por_nombre_snapshot", "solicitada_por_rol_snapshot",
  "solicitada_at", "retirada_motivo", "retirada_at", "source_device",
  "version", "is_deleted", "created_at", "updated_at", "deleted_at",
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
      "TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cierre_cadena_solicitud'",
  );

try {
  const backup = await backupMariadb();
  if ((await columnas()).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE cierre_cadena_solicitud (
        solicitud_id VARCHAR(191) NOT NULL,
        tipo_periodo VARCHAR(191) NOT NULL,
        fecha_inicio DATETIME(3) NOT NULL,
        fecha_fin_exclusiva DATETIME(3) NOT NULL,
        estado VARCHAR(191) NOT NULL,
        nota VARCHAR(191) NULL,
        fecha_limite DATETIME(3) NULL,
        solicitada_por_user_id VARCHAR(191) NOT NULL,
        solicitada_por_nombre_snapshot VARCHAR(191) NOT NULL,
        solicitada_por_rol_snapshot VARCHAR(191) NOT NULL,
        solicitada_at DATETIME(3) NOT NULL,
        retirada_motivo VARCHAR(191) NULL,
        retirada_at DATETIME(3) NULL,
        source_device VARCHAR(191) NULL,
        version INT NOT NULL DEFAULT 1,
        is_deleted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (solicitud_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Una sola solicitud viva por período: pedir dos veces lo mismo dejaría al
    // semáforo sin saber contra cuál medir, y a la sede con dos avisos iguales.
    await prisma.$executeRawUnsafe(
      "CREATE UNIQUE INDEX uq_cierre_cadena_periodo ON cierre_cadena_solicitud " +
        "(tipo_periodo, fecha_inicio, fecha_fin_exclusiva)",
    );
    console.log("Tabla `cierre_cadena_solicitud` creada.");
  } else {
    console.log("La tabla ya existía; no se recrea.");
  }

  const presentes = new Set((await columnas()).map((c) => c.COLUMN_NAME));
  const faltan = [...COLUMNAS].filter((c) => !presentes.has(c));
  if (faltan.length > 0) {
    throw new Error(`Faltan columnas tras migrar: ${faltan.join(", ")}`);
  }
  const [{ filas }] = await prisma.$queryRawUnsafe<Array<{ filas: bigint }>>(
    "SELECT COUNT(*) AS filas FROM cierre_cadena_solicitud",
  );
  console.log(
    `OK · ${presentes.size} columnas · ${Number(filas)} solicitudes · respaldo ${backup}`,
  );
} finally {
  await prisma.$disconnect();
}
