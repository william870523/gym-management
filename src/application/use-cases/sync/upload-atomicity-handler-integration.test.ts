/**
 * Unidad 01 — Paso 3: prueba de integración de un handler DEDICADO real.
 *
 * Manual: docs/execution/01_R5P_UPLOAD_ATOMICITY.md
 *
 * El test de caracterización usa un handler falso; aquí se comprueba que el
 * handler dedicado REAL (`ApplyHorarioEventUseCase`) y su repositorio real
 * (`PrismaHorarioRepository`) propagan el `tx` del upload, de modo que la
 * escritura de la entidad y la de `sync_log` viven en la misma transacción.
 *
 * `horario` es el handler más simple (una sola tabla) y sirve de patrón: si
 * este propaga el `tx`, la receta aplicada al resto también.
 */

import { describe, expect, it } from "bun:test";
import { UploadEventsUseCase } from "./UploadEventsUseCase";
import { ApplyHorarioEventUseCase } from "./ApplyHorarioEventUseCase";
import { PrismaHorarioRepository } from "../../../infrastructure/repositories/PrismaHorarioRepository";
import { PrismaSyncLogRepository } from "../../../infrastructure/repositories/PrismaSyncLogRepository";

/**
 * Delegado de un modelo sobre un mapa: implementa lo que usan
 * `gym-scoped-sync-write` (findUnique/create/updateMany) y
 * `PrismaSyncLogRepository` (findUnique/create).
 */
function makeDelegate(store: Map<string, any>, pk: string, opts: { failOnCreate?: boolean } = {}) {
  return {
    async findUnique({ where }: any) {
      const key = where[pk] ?? where.event_id;
      return store.get(key) ?? null;
    },
    async create({ data }: any) {
      if (opts.failOnCreate) throw new Error("Falla inyectada en create");
      const key = data[pk] ?? data.event_id;
      store.set(key, data);
      return data;
    },
    async updateMany({ where, data }: any) {
      const key = where[pk];
      const existing = store.get(key);
      if (!existing) return { count: 0 };
      store.set(key, { ...existing, ...data });
      return { count: 1 };
    },
  };
}

/**
 * Transacción falsa con semántica de commit/rollback: las escrituras van a un
 * staging y solo se fusionan al estado confirmado si el callback resuelve.
 */
function makeFakeDatabase(opts: { failSyncLogCreate?: boolean } = {}) {
  const committed = { horarios: new Map<string, any>(), syncLog: new Map<string, any>() };

  const runner = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const staging = { horarios: new Map(committed.horarios), syncLog: new Map(committed.syncLog) };
    const tx = {
      horario: makeDelegate(staging.horarios, "horario_id"),
      syncLog: makeDelegate(staging.syncLog, "event_id", {
        failOnCreate: opts.failSyncLogCreate,
      }),
    };
    const result = await fn(tx);
    committed.horarios = staging.horarios;
    committed.syncLog = staging.syncLog;
    return result;
  };

  return { committed, runner };
}

function buildUseCase(db: ReturnType<typeof makeFakeDatabase>) {
  // Repos reales, con delegados por defecto irrelevantes: el upload siempre
  // entra por withTransaction(tx), que usa los delegados de la transacción.
  const horarioRepo = new PrismaHorarioRepository({} as any);
  const syncLogRepo = new PrismaSyncLogRepository({} as any);
  const horarioHandler = new ApplyHorarioEventUseCase(horarioRepo);

  const dummy = { execute: async () => undefined } as any;
  const handlers = Array.from({ length: 16 }, () => dummy);
  handlers[10] = horarioHandler; // posición de horario en el constructor

  return new (UploadEventsUseCase as any)(syncLogRepo, ...handlers, db.runner) as UploadEventsUseCase;
}

function makeDto() {
  return {
    device_id: "demo-upload-atomicity-device",
    gym_id: "demo-upload-atomicity-gym",
    sent_at_utc: "2026-07-23T00:00:00.000Z",
    clock_offset_ms: 0,
    gym_timezone: "America/Havana",
    events: [
      {
        event_id: "demo-upload-atomicity-hz-1",
        entidad: "horario",
        operacion: "INSERT",
        entidad_id: "demo-upload-atomicity-h-1",
        payload: {
          horario_id: "demo-upload-atomicity-h-1",
          nombre_horario: "Turno demo",
          hora_inicio: 6,
          hora_fin: 22,
        },
        occurred_at_utc: "2026-07-23T00:00:00.000Z",
      },
    ],
  } as any;
}

function makeInsertDeleteDto() {
  const dto = makeDto();
  dto.events.push({
    event_id: "demo-upload-atomicity-hz-delete-1",
    entidad: "horario",
    operacion: "DELETE",
    entidad_id: "demo-upload-atomicity-h-1",
    payload: {
      horario_id: "demo-upload-atomicity-h-1",
      version: 2,
    },
    occurred_at_utc: "2026-07-23T00:01:00.000Z",
  });
  return dto;
}

describe("Paso 3 — handler dedicado horario dentro de la transacción", () => {
  it("éxito: la entidad y el sync_log se confirman juntos", async () => {
    const db = makeFakeDatabase();
    const useCase = buildUseCase(db);

    const res: any = await useCase.execute(makeDto());

    expect(res.accepted_event_ids).toEqual(["demo-upload-atomicity-hz-1"]);
    expect(db.committed.horarios.size).toBe(1);
    expect(db.committed.syncLog.size).toBe(1);
  });

  it("atomicidad: si falla sync_log, la escritura del horario NO persiste", async () => {
    const db = makeFakeDatabase({ failSyncLogCreate: true });
    const useCase = buildUseCase(db);

    const res: any = await useCase.execute(makeDto());

    // La entidad se escribió en el staging, pero el fallo de sync_log descartó
    // toda la transacción: nada llega al estado confirmado.
    expect(db.committed.horarios.size).toBe(0);
    expect(db.committed.syncLog.size).toBe(0);
    expect(res.failed_event_id).toBe("demo-upload-atomicity-hz-1");
    expect(res.accepted_event_ids).toEqual([]);
  });

  it("PD-4: DELETE conserva en remoto la versión incrementada por el emisor", async () => {
    const db = makeFakeDatabase();
    const useCase = buildUseCase(db);

    const res: any = await useCase.execute(makeInsertDeleteDto());

    expect(res.accepted_event_ids).toEqual([
      "demo-upload-atomicity-hz-1",
      "demo-upload-atomicity-hz-delete-1",
    ]);
    expect(db.committed.horarios.get("demo-upload-atomicity-h-1")).toMatchObject({
      is_deleted: true,
      version: 2,
    });
    expect(db.committed.syncLog.size).toBe(2);
  });
});
