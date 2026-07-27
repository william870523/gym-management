/**
 * Auditoría del `sync_log` remoto: eventos **por descargar** cuya entidad ya no
 * existe en MariaDB.
 *
 * Es el gemelo remoto de `audit:orphan-outbox` (unidad 02), y hacía falta: la
 * descarga también respeta el orden estricto, así que un evento que apunta al
 * vacío **para a todos los dispositivos** detrás de él. Pasó el 26-07-2026 con
 * 60 esquemas de cuota de un plan de prueba ya borrado: la cola quedó parada en
 * el cursor 36489.
 *
 *   bun run audit:orphan-sync-log -- --desde 36489
 *   bun run audit:orphan-sync-log -- --desde 36489 --apply
 *
 * No es «drenar la cola»: comprueba entidad por entidad, nunca toca los
 * `DELETE` —borrar algo ya ausente es legítimo— y escribe el manifiesto exacto
 * de lo que retira para poder auditarlo después.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const APPLY = process.argv.includes("--apply");
const desdeIndex = process.argv.indexOf("--desde");
const DESDE = desdeIndex >= 0 ? Number(process.argv[desdeIndex + 1]) : 0;

const existe: Record<string, (id: string) => Promise<boolean>> = {
  cliente: async (id) => Boolean(await prisma.cliente.findUnique({ where: { ci: id } })),
  pago_cliente: async (id) =>
    Boolean(await prisma.pagoCliente.findUnique({ where: { pago_cliente_id: id } })),
  detalle_pago: async (id) =>
    Boolean(await prisma.detallePago.findUnique({ where: { detalle_pago_id: id } })),
  membresia_cliente: async (id) =>
    Boolean(await prisma.membresiaCliente.findUnique({ where: { membresia_id: id } })),
  membresia_cuota: async (id) =>
    Boolean(await prisma.membresiaCuota.findUnique({ where: { cuota_instancia_id: id } })),
  plan_cuota_esquema: async (id) =>
    Boolean(await prisma.planCuotaEsquema.findUnique({ where: { esquema_id: id } })),
  planes_pago: async (id) =>
    Boolean(await prisma.planesPago.findUnique({ where: { id_planes_pago: id } })),
  tesoreria_movimiento: async (id) =>
    Boolean(await prisma.tesoreriaMovimiento.findUnique({ where: { movimiento_id: id } })),
  pago_membresia_aplicacion: async (id) =>
    Boolean(await prisma.pagoMembresiaAplicacion.findUnique({ where: { aplicacion_id: id } })),
  membresia_entrenador_asignacion: async (id) =>
    Boolean(
      await prisma.membresiaEntrenadorAsignacion.findUnique({
        where: { asignacion_id: id },
      }),
    ),
  user: async (id) => Boolean(await prisma.user.findUnique({ where: { user_id: id } })),
};

const pendientes = await prisma.syncLog.findMany({
  where: { id: { gt: DESDE } },
  orderBy: { id: "asc" },
  select: {
    id: true,
    entidad: true,
    entidad_id: true,
    operacion: true,
    gym_id: true,
    created_at: true,
  },
});

const huerfanos: typeof pendientes = [];
const sinComprobar = new Set<string>();
for (const ev of pendientes) {
  const check = existe[ev.entidad];
  if (!check) {
    sinComprobar.add(ev.entidad);
    continue;
  }
  if (ev.operacion === "DELETE") continue;
  if (!(await check(ev.entidad_id))) huerfanos.push(ev);
}

const porEntidad = new Map<string, number>();
for (const h of huerfanos) porEntidad.set(h.entidad, (porEntidad.get(h.entidad) ?? 0) + 1);

console.log(`desde el cursor          : ${DESDE}`);
console.log(`eventos por descargar    : ${pendientes.length}`);
console.log(`huérfanos (entidad ida)  : ${huerfanos.length}`);
for (const [entidad, n] of [...porEntidad].sort()) {
  console.log(`  ${entidad.padEnd(32)} ${n}`);
}
if (sinComprobar.size) {
  console.log(`entidades no comprobadas : ${[...sinComprobar].sort().join(", ")}`);
}
if (huerfanos.length) {
  console.log(`primero                  : ${huerfanos[0]!.id}`);
  console.log(`último                   : ${huerfanos[huerfanos.length - 1]!.id}`);
}

// El manifiesto se escribe SIEMPRE, también en simulación: es lo que permite
// revisar antes de aplicar y auditar después.
if (huerfanos.length) {
  const dir = resolve(__dirname, "../../docs/evidence/r56-remote-queue");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const file = resolve(dir, `manifiesto-huerfanos-${stamp}.csv`);
  writeFileSync(
    file,
    ["id,entidad,operacion,entidad_id,gym_id,created_at"]
      .concat(
        huerfanos.map((h) =>
          [h.id, h.entidad, h.operacion, h.entidad_id, h.gym_id ?? "", h.created_at?.toISOString() ?? ""]
            .join(","),
        ),
      )
      .join("\n"),
    "utf8",
  );
  console.log(`manifiesto               : ${file}`);
}

if (APPLY && huerfanos.length) {
  const res = await prisma.syncLog.deleteMany({
    where: { id: { in: huerfanos.map((h) => h.id) } },
  });
  console.log(`\nRETIRADOS: ${res.count}`);
  console.log(
    `pendientes restantes: ${await prisma.syncLog.count({ where: { id: { gt: DESDE } } })}`,
  );
} else if (huerfanos.length) {
  console.log("\n(simulación: pasar --apply para retirarlos)");
}

await prisma.$disconnect();
