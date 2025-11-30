import "dotenv/config";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type EntityKey =
  | "cliente"
  | "cliente_peso"
  | "asistencia"
  | "pago_cliente"
  | "detalle_pago"
  | "user"
  | "gym"
  | "device"
  | "monedas"
  | "nacionalidades"
  | "tipo_pago"
  | "tipo_cambio"
  | "referencia"
  | "horario"
  | "planes_pago"
  | "cuenta"
  | "entrenadores";

type WithId = { [k: string]: any };

const GLOBAL_ENTITIES: EntityKey[] = [
  "monedas",
  "nacionalidades",
  "tipo_pago",
  "tipo_cambio",
  "referencia",
];

function opFor(row: any): "INSERT" | "DELETE" {
  if (row.is_deleted === true) return "DELETE";
  if (row.deleted_at) return "DELETE";
  return "INSERT";
}

async function addEvents<T extends WithId>(
  entidad: EntityKey,
  items: T[],
  pk: string,
  deviceId: string,
  targetGymId?: string | null
) {
  for (const row of items) {
    const entidad_id = row[pk];
    const gym_id = GLOBAL_ENTITIES.includes(entidad) ? null : targetGymId ?? null;

    await prisma.syncLog.create({
      data: {
        event_id: randomUUID(),
        entidad,
        operacion: opFor(row),
        entidad_id,
        gym_id,
        device_id: deviceId,
        payload_json: JSON.stringify(row),
      },
    });
  }
}

async function main() {
  const deviceId = process.env.DEVICE_ID ?? "device-001";
  const targetGymId = process.env.GYM_ID ?? "local-gym-001";
  console.log("Clearing sync_log...");
  await prisma.syncLog.deleteMany({});

  const [
    gyms,
    devices,
    monedas,
    nacionalidades,
    tiposPago,
    tiposCambio,
    referencias,
    horarios,
    planes,
    cuentas,
    entrenadores,
    users,
    clientes,
    pesos,
    asistencias,
    pagos,
    detalles,
  ] = await Promise.all([
    prisma.gym.findMany(),
    prisma.device.findMany(),
    prisma.moneda.findMany(),
    prisma.nacionalidad.findMany(),
    prisma.tipoPago.findMany(),
    prisma.tipoCambio.findMany(),
    prisma.referencia.findMany(),
    prisma.horario.findMany(),
    prisma.planesPago.findMany(),
    prisma.cuenta.findMany(),
    prisma.entrenador.findMany(),
    prisma.user.findMany(),
    prisma.cliente.findMany(),
    prisma.clientePeso.findMany(),
    prisma.asistencia.findMany(),
    prisma.pagoCliente.findMany(),
    prisma.detallePago.findMany(),
  ]);

  console.log("Inserting sync events...");
  await addEvents("gym", gyms, "gym_id", deviceId, targetGymId);
  await addEvents("device", devices, "device_id", deviceId, targetGymId);
  await addEvents("monedas", monedas, "moneda_id", deviceId);
  await addEvents("nacionalidades", nacionalidades, "nacionalidad_id", deviceId);
  await addEvents("tipo_pago", tiposPago, "tipo_pago_id", deviceId);
  await addEvents("tipo_cambio", tiposCambio, "tipo_cambio_id", deviceId);
  await addEvents("referencia", referencias, "referencia_id", deviceId);
  await addEvents("horario", horarios, "horario_id", deviceId, targetGymId);
  await addEvents("planes_pago", planes, "id_planes_pago", deviceId, targetGymId);
  await addEvents("cuenta", cuentas, "cuenta_id", deviceId, targetGymId);
  await addEvents("entrenadores", entrenadores, "id_entrenador", deviceId, targetGymId);
  await addEvents("user", users, "user_id", deviceId, targetGymId);
  await addEvents("cliente", clientes, "ci", deviceId, targetGymId);
  await addEvents("cliente_peso", pesos, "cliente_peso_id", deviceId, targetGymId);
  await addEvents("asistencia", asistencias, "asistencia_id", deviceId, targetGymId);
  await addEvents("pago_cliente", pagos, "pago_cliente_id", deviceId, targetGymId);
  await addEvents("detalle_pago", detalles, "detalle_pago_id", deviceId, targetGymId);

  console.log("Done. Events in sync_log:", await prisma.syncLog.count());
}

main()
  .catch((err) => {
    console.error("backfill-sync-log failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
