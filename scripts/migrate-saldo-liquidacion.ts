/**
 * M8 — liquidación del saldo entre sedes (MariaDB). Gemela de la de
 * `gym-local-api`. Diseño: docs/MULTI_SEDE.md §5.4.
 *
 * ## Qué guarda, y por qué el asiento no basta
 *
 * Liquidar deja **un asiento `DESHACE`** en `saldo_enlace_asiento` —que es lo
 * que baja el saldo, porque el saldo no se guarda: se suma— y **esta fila**, con
 * lo que el asiento no sabe decir.
 *
 * El libro de asientos **no lleva autor**: nació de cobros, donde el autor ya
 * estaba en el cobro. Una transferencia entre dos negocios sin nadie que
 * responda por ella es exactamente la clase de apunte que nadie puede aclarar
 * seis meses después, así que aquí el actor va **congelado** (id, nombre y rol
 * copiados), como en el resto del proyecto: renombrar o dar de baja a alguien no
 * puede cambiar quién firmó lo que firmó.
 *
 * `saldo_antes` y `saldo_despues` guardan lo que se creía en ese momento. Si
 * mañana aparece un cobro atrasado con fecha vieja, el saldo recalculado cambia
 * y esta foto es lo único que explica por qué se transfirió esa cifra y no otra.
 *
 * ## Por qué lleva `gym_id`, y de quién es
 *
 * De la sede **deudora**, la misma del asiento: es la que sacó el dinero de su
 * caja y la que tiene que cuadrarla. Entidad de sede corriente, no de alcance
 * global. La acreedora no la descarga —su ingreso ya lo tenía contado desde el
 * cobro; lo que le llega es dinero, no contabilidad nueva— y ve la liquidación
 * desde el concentrador, que es quien arbitra entre las dos.
 *
 * ## `clase_cobro` pasa a significar otra cosa
 *
 * En `saldo_enlace_asiento` esa columna decía `PLAN | PLUS_MULTISEDE`: **qué se
 * cobró**. Un asiento de liquidación no es ninguna de las dos, así que la
 * columna pasa a decir **por qué nace el asiento**, con el valor `LIQUIDACION`.
 * Nadie filtra hoy por ella —solo se escribe—, así que el cambio es seguro; queda
 * escrito aquí para quien la lea mañana esperando lo de antes.
 *
 * Crea la tabla y **no siembra ninguna liquidación**: registrarla es un acto con
 * su actor congelado, y fabricarla aquí dejaría un pago que nadie hizo.
 *
 * Uso:
 *   SALDO_LIQUIDACION_BACKUP_PATH=/ruta/dump.sql bun scripts/migrate-saldo-liquidacion.ts
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNAS = new Set([
  "liquidacion_id", "gym_id", "acreedor_tipo", "acreedor_gym_id", "moneda_id",
  "monto", "saldo_antes", "saldo_despues", "dejo_saldo_a_favor", "asiento_id",
  "referencia", "nota", "registrado_por_user_id",
  "registrado_por_nombre_snapshot", "registrado_por_rol_snapshot",
  "ocurrido_at", "fecha_negocio", "source_device", "version", "is_deleted",
  "created_at", "updated_at", "deleted_at",
  // Anular es contraasentar: la fila se marca, no se borra.
  "estado", "asiento_anulacion_id", "anulada_motivo", "anulada_at",
  "anulada_por_user_id", "anulada_por_nombre_snapshot",
  "anulada_por_rol_snapshot",
]);

async function backupMariadb() {
  const ruta = process.env.SALDO_LIQUIDACION_BACKUP_PATH;
  if (!ruta || !existsSync(resolve(ruta)) || statSync(resolve(ruta)).size <= 0) {
    throw new Error(
      "Defina SALDO_LIQUIDACION_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }
  console.log(`Respaldo MariaDB verificado: ${resolve(ruta)}`);
  return resolve(ruta);
}

const columnas = () =>
  prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE " +
      "TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saldo_liquidacion'",
  );

try {
  const backup = await backupMariadb();
  if ((await columnas()).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE saldo_liquidacion (
        liquidacion_id VARCHAR(191) NOT NULL,
        gym_id VARCHAR(191) NOT NULL,
        acreedor_tipo VARCHAR(191) NOT NULL,
        acreedor_gym_id VARCHAR(191) NULL,
        moneda_id VARCHAR(191) NOT NULL,
        monto DECIMAL(18, 2) NOT NULL,
        saldo_antes DECIMAL(18, 2) NOT NULL,
        saldo_despues DECIMAL(18, 2) NOT NULL,
        dejo_saldo_a_favor TINYINT(1) NOT NULL DEFAULT 0,
        estado VARCHAR(191) NOT NULL DEFAULT 'VIGENTE',
        asiento_id VARCHAR(191) NOT NULL,
        asiento_anulacion_id VARCHAR(191) NULL,
        referencia VARCHAR(191) NULL,
        nota TEXT NULL,
        registrado_por_user_id VARCHAR(191) NOT NULL,
        registrado_por_nombre_snapshot VARCHAR(191) NOT NULL,
        registrado_por_rol_snapshot VARCHAR(191) NOT NULL,
        anulada_motivo TEXT NULL,
        anulada_at DATETIME(3) NULL,
        anulada_por_user_id VARCHAR(191) NULL,
        anulada_por_nombre_snapshot VARCHAR(191) NULL,
        anulada_por_rol_snapshot VARCHAR(191) NULL,
        ocurrido_at DATETIME(3) NOT NULL,
        fecha_negocio DATETIME(3) NOT NULL,
        source_device VARCHAR(191) NULL,
        version INT NOT NULL DEFAULT 1,
        is_deleted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (liquidacion_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Un asiento, una liquidación. Si dos filas apuntaran al mismo asiento, el
    // saldo habría bajado una vez y la contabilidad diría que se pagó dos.
    await prisma.$executeRawUnsafe(
      "CREATE UNIQUE INDEX uq_saldo_liquidacion_asiento ON saldo_liquidacion (asiento_id)",
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX idx_saldo_liquidacion_acreedor ON saldo_liquidacion " +
        "(gym_id, acreedor_tipo, acreedor_gym_id, moneda_id)",
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX idx_saldo_liquidacion_gym_dia ON saldo_liquidacion (gym_id, fecha_negocio)",
    );
    console.log("Tabla `saldo_liquidacion` creada.");
  } else {
    console.log("La tabla ya existía; no se recrea.");
  }

  // Aditiva: la tabla pudo crearse antes de que existiera la anulación, así que
  // las columnas que falten se añaden en vez de exigir recrearla. Recrearla
  // perdería las liquidaciones ya registradas, que son dinero movido de verdad.
  const TIPOS: Record<string, string> = {
    estado: "VARCHAR(191) NOT NULL DEFAULT 'VIGENTE'",
    asiento_anulacion_id: "VARCHAR(191) NULL",
    anulada_motivo: "TEXT NULL",
    anulada_at: "DATETIME(3) NULL",
    anulada_por_user_id: "VARCHAR(191) NULL",
    anulada_por_nombre_snapshot: "VARCHAR(191) NULL",
    anulada_por_rol_snapshot: "VARCHAR(191) NULL",
  };
  for (const [columna, tipo] of Object.entries(TIPOS)) {
    const hay = new Set((await columnas()).map((c) => c.COLUMN_NAME));
    if (!hay.has(columna)) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE saldo_liquidacion ADD COLUMN ${columna} ${tipo}`,
      );
      console.log(`Columna \`${columna}\` añadida.`);
    }
  }

  const presentes = new Set((await columnas()).map((c) => c.COLUMN_NAME));
  const faltan = [...COLUMNAS].filter((c) => !presentes.has(c));
  if (faltan.length > 0) {
    throw new Error(`Faltan columnas tras migrar: ${faltan.join(", ")}`);
  }
  const [{ filas }] = await prisma.$queryRawUnsafe<Array<{ filas: bigint }>>(
    "SELECT COUNT(*) AS filas FROM saldo_liquidacion",
  );
  console.log(
    `OK · ${presentes.size} columnas · ${Number(filas)} liquidaciones · respaldo ${backup}`,
  );
} finally {
  await prisma.$disconnect();
}
