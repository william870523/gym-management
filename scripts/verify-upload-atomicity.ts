/**
 * Unidad 01 — Paso 6: verificación de atomicidad contra MariaDB real.
 *
 * Manual: docs/execution/01_R5P_UPLOAD_ATOMICITY.md (paso 6).
 *
 * Demuestra sobre la base real que:
 *   1. un evento aplicado deja entidad + sync_log (éxito);
 *   2. repetir el mismo event_id es duplicado idempotente, sin nuevas filas;
 *   3. si sync_log.register falla, la escritura de la entidad se REVIERTE
 *      (no queda horario sin log) — rollback real del motor;
 *   4. la cola auditada (resto de sync_log) no cambia.
 *
 * Usa IDs con prefijo `demo-upload-atomicity-` y los retira al final.
 * NO toca la cola pendiente real descrita en SYNC_QUEUE_AUDIT_2026-07-21.md.
 *
 * Ejecutar:  bun run scripts/verify-upload-atomicity.ts
 */

import { prisma } from "../src/infrastructure/db/prismaClient";
import { UploadEventsUseCase } from "../src/application/use-cases/sync/UploadEventsUseCase";
import { ApplyHorarioEventUseCase } from "../src/application/use-cases/sync/ApplyHorarioEventUseCase";
import { PrismaHorarioRepository } from "../src/infrastructure/repositories/PrismaHorarioRepository";
import { PrismaSyncLogRepository } from "../src/infrastructure/repositories/PrismaSyncLogRepository";

const PREFIX = "demo-upload-atomicity-";
const OK_ID = `${PREFIX}h-ok`;
const OK_EVENT = `${PREFIX}ev-ok`;
const FAIL_ID = `${PREFIX}h-fail`;
const FAIL_EVENT = `${PREFIX}ev-fail`;

function dummy() {
  return { execute: async () => undefined } as any;
}

function buildUseCase(syncLogRepository: any) {
  const horarioHandler = new ApplyHorarioEventUseCase(new PrismaHorarioRepository());
  const handlers = Array.from({ length: 16 }, () => dummy());
  handlers[10] = horarioHandler; // posición de horario
  // Sin el último argumento → usa el prisma.$transaction real.
  return new (UploadEventsUseCase as any)(syncLogRepository, ...handlers) as UploadEventsUseCase;
}

function horarioEvent(eventId: string, entidadId: string) {
  return {
    event_id: eventId,
    entidad: "horario",
    operacion: "INSERT",
    entidad_id: entidadId,
    payload: {
      horario_id: entidadId,
      nombre_horario: "Turno verificación atomicidad",
      hora_inicio: 6,
      hora_fin: 22,
    },
    occurred_at_utc: new Date().toISOString(),
  };
}

async function cleanup() {
  await prisma.horario.deleteMany({ where: { horario_id: { in: [OK_ID, FAIL_ID] } } });
  await prisma.syncLog.deleteMany({ where: { event_id: { in: [OK_EVENT, FAIL_EVENT] } } });
}

async function countHorario(id: string) {
  return prisma.horario.count({ where: { horario_id: id } });
}
async function countSyncLog(eventId: string) {
  return prisma.syncLog.count({ where: { event_id: eventId } });
}

async function main() {
  const gym = await prisma.gym.findFirst({ select: { gym_id: true } });
  if (!gym) throw new Error("No hay ningún gimnasio en la base; no se puede probar FK.");
  const gymId = gym.gym_id;
  const deviceId = `${PREFIX}device`;

  console.log("== Paso 6 · verificación de atomicidad contra MariaDB ==");
  console.log("gym_id de prueba:", gymId);

  const baselineTotal = await prisma.syncLog.count();
  console.log("sync_log total (baseline):", baselineTotal);

  await cleanup(); // por si una corrida previa dejó restos

  const dto = (events: unknown[]) => ({
    device_id: deviceId,
    gym_id: gymId,
    sent_at_utc: new Date().toISOString(),
    clock_offset_ms: 0,
    gym_timezone: "America/Havana",
    events,
  });

  const realSyncLog = new PrismaSyncLogRepository();
  const useCase = buildUseCase(realSyncLog);

  // 1. ÉXITO
  const okRes: any = await useCase.execute(dto([horarioEvent(OK_EVENT, OK_ID)]) as any);
  const okHorario = await countHorario(OK_ID);
  const okLog = await countSyncLog(OK_EVENT);
  console.log("\n[1] ÉXITO");
  console.log("  respuesta:", JSON.stringify(okRes));
  console.log("  horario en base:", okHorario, "| sync_log en base:", okLog);
  const successOk =
    okRes.accepted_event_ids.includes(OK_EVENT) && okHorario === 1 && okLog === 1;

  // 2. REPETICIÓN (idempotencia)
  const dupRes: any = await useCase.execute(dto([horarioEvent(OK_EVENT, OK_ID)]) as any);
  const okHorario2 = await countHorario(OK_ID);
  const okLog2 = await countSyncLog(OK_EVENT);
  console.log("\n[2] REPETICIÓN");
  console.log("  respuesta:", JSON.stringify(dupRes));
  console.log("  horario en base:", okHorario2, "| sync_log en base:", okLog2);
  const dupOk =
    dupRes.duplicate_event_ids.includes(OK_EVENT) && okHorario2 === 1 && okLog2 === 1;

  // 3. FALLO INYECTADO EN sync_log → rollback real de la entidad
  const throwingSyncLog = {
    exists: (id: string, tx?: any) => realSyncLog.exists(id, tx),
    register: async () => {
      throw new Error("Falla inyectada en sync_log.register (paso 6)");
    },
  } as any;
  const failingUseCase = buildUseCase(throwingSyncLog);
  const failRes: any = await failingUseCase.execute(
    dto([horarioEvent(FAIL_EVENT, FAIL_ID)]) as any,
  );
  const failHorario = await countHorario(FAIL_ID);
  const failLog = await countSyncLog(FAIL_EVENT);
  console.log("\n[3] FALLO INYECTADO (rollback real)");
  console.log("  respuesta:", JSON.stringify(failRes));
  console.log("  horario en base:", failHorario, "| sync_log en base:", failLog);
  const rollbackOk =
    failRes.failed_event_id === FAIL_EVENT && failHorario === 0 && failLog === 0;

  // 4. COLA AUDITADA INTACTA: el único sync_log nuevo es el del éxito.
  const finalTotal = await prisma.syncLog.count();
  console.log("\n[4] COLA AUDITADA");
  console.log("  sync_log total ahora:", finalTotal, "(baseline + 1 esperado)");
  const queueOk = finalTotal === baselineTotal + 1;

  // Retirar los datos de prueba.
  await cleanup();
  const afterCleanup = await prisma.syncLog.count();
  console.log("  sync_log total tras limpieza:", afterCleanup, "(= baseline)");
  const cleanupOk = afterCleanup === baselineTotal;

  console.log("\n== RESULTADO ==");
  const rows = [
    ["1 éxito: entidad + sync_log", successOk],
    ["2 repetición idempotente", dupOk],
    ["3 rollback real al fallar sync_log", rollbackOk],
    ["4 cola auditada intacta", queueOk],
    ["limpieza vuelve al baseline", cleanupOk],
  ] as const;
  for (const [label, ok] of rows) console.log(`  ${ok ? "OK " : "XX "} ${label}`);

  const allOk = rows.every(([, ok]) => ok);
  await prisma.$disconnect();
  if (!allOk) {
    console.error("\nFALLÓ al menos una comprobación.");
    process.exit(1);
  }
  console.log("\nTodas las comprobaciones pasaron.");
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
