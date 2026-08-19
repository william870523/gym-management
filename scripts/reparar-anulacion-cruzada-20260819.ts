/**
 * Reparación puntual del 19-08-2026: dos filas divergentes al implementar la
 * anulación del cobro cruzado (§7.8).
 *
 * ## Qué pasó
 *
 * 1. La primera anulación se hizo con el código a medias: emitía el
 *    `pago_cliente/DELETE` **solo para la sede dueña del ingreso**, cuando el
 *    alta de ese cobro había alcanzado a las dos. La instalación de la sede que
 *    tenía el efectivo se quedó con el cobro vivo mientras el concentrador lo
 *    daba por anulado. Lo cazó la huella de paridad, que es para lo que está.
 * 2. Al arreglarlo se mandó también la ficha del socio a esa segunda sede, y eso
 *    fue peor: la rama genérica del worker estampa `env.GYM_ID` en toda entidad
 *    de sede, así que **la instalación se apropió del socio**. Se retiró ese
 *    alcance: lo que la sede del efectivo necesita es el cobro, no la
 *    titularidad del miembro.
 *
 * El código ya está corregido y se comprobó con el **segundo** cobro cruzado,
 * que convergió solo. Esto repara las dos filas que se quedaron atrás.
 *
 * - El cobro va **por la cola**: se emite el evento que el código corregido
 *   habría emitido, y el worker lo aplica. No se toca la fila local.
 * - El socio se corrige **directamente en SQLite**, porque no hay camino:
 *   cualquier evento de `cliente` que baje volverá a estamparle la sede de la
 *   instalación. Se le devuelve el `gym_id` del concentrador, que es su dueño.
 *
 * Uso:
 *   bun scripts/reparar-anulacion-cruzada-20260819.ts --confirmar
 */
import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COBRO = "06769e85-d9c0-45b6-8f96-f73d48f9d136";
const SOCIO = "99090100009";
const SEDE_DEL_EFECTIVO = "local-gym-001";

const confirmar = process.argv.includes("--confirmar");

try {
  const cobro = await prisma.pagoCliente.findUnique({
    where: { pago_cliente_id: COBRO },
  });
  if (!cobro) throw new Error("El cobro no existe en el concentrador.");
  const dueña = String(cobro.gym_id ?? "");

  const ruta = resolve(import.meta.dir, "../../gym-local-api/prisma/gym.db");
  // `bun:sqlite` no admite el objeto de opciones aquí: o se abre normal o se
  // abre de solo lectura con la constante. Ya tropezó una vez el 18-08-2026.
  const local = confirmar ? new Database(ruta) : new Database(ruta, { readonly: true } as any);
  const antesCobro = local
    .query("SELECT is_deleted FROM pago_cliente WHERE pago_cliente_id = ?")
    .get(COBRO) as { is_deleted: number } | null;
  const antesSocio = local
    .query("SELECT gym_id FROM cliente WHERE ci = ?")
    .get(SOCIO) as { gym_id: string } | null;

  console.log(
    `Concentrador · cobro is_deleted=${cobro.is_deleted} · socio dueño=${dueña}\n` +
      `Instalación  · cobro is_deleted=${antesCobro?.is_deleted} · socio gym_id=${antesSocio?.gym_id}`,
  );

  if (!confirmar) {
    console.log("\nEn seco. Añada --confirmar para reparar.");
    local.close();
    process.exit(0);
  }

  if (antesSocio && antesSocio.gym_id !== dueña) {
    local.run("UPDATE cliente SET gym_id = ? WHERE ci = ?", [dueña, SOCIO]);
    console.log(`Socio ${SOCIO}: gym_id devuelto a ${dueña}.`);
  } else {
    console.log("Socio ya correcto; no se toca.");
  }
  local.close();

  const yaEmitido = await prisma.syncLog.findFirst({
    where: {
      entidad: "pago_cliente",
      operacion: "DELETE",
      entidad_id: COBRO,
      gym_id: SEDE_DEL_EFECTIVO,
    },
  });
  if (yaEmitido) {
    console.log("El evento del cobro ya estaba emitido para esa sede.");
  } else {
    await prisma.syncLog.create({
      data: {
        event_id: randomUUID(),
        entidad: "pago_cliente",
        operacion: "DELETE",
        entidad_id: COBRO,
        gym_id: SEDE_DEL_EFECTIVO,
        device_id: null,
        payload_json: JSON.stringify(cobro, (_k, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      },
    });
    console.log(`Evento emitido: pago_cliente/DELETE para ${SEDE_DEL_EFECTIVO}.`);
  }
  console.log("\nEncienda las dos APIs y deje drenar; luego mida la huella.");
} finally {
  await prisma.$disconnect();
}
