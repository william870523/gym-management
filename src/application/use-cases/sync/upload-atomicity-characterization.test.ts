/**
 * Unidad 01 — Paso 1: caracterización del lote de upload y de su atomicidad.
 *
 * Manual: docs/execution/01_R5P_UPLOAD_ATOMICITY.md
 *
 * QUÉ PRUEBA ESTE ARCHIVO
 * -----------------------
 * El contrato objetivo de `UploadEventsUseCase.execute`:
 *
 *   1. devuelve { accepted_event_ids, duplicate_event_ids, failed_event_id,
 *      processed } en vez de solo { processed };
 *   2. no propaga la excepción de un evento: la reporta en `failed_event_id`;
 *   3. detiene el lote en el primer fallo y no procesa los posteriores;
 *   4. entidad y `sync_log` se confirman o se revierten JUNTAS.
 *
 * ESTADO ESPERADO HOY: todos los tests de este archivo fallan salvo
 * "éxito de evento único", que documenta el camino feliz ya correcto.
 *
 * CÓMO SE PONEN VERDES (contrato que debe cumplir la implementación)
 * ------------------------------------------------------------------
 * a) El constructor acepta como ÚLTIMO parámetro OPCIONAL un ejecutor
 *    transaccional:
 *
 *      type TxRunner = <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
 *      // por defecto: (fn) => prisma.$transaction(fn)
 *
 *    Se añade al final para no tocar los 17 parámetros existentes ni sus
 *    puntos de construcción.
 *
 * b) Cada handler recibe el contexto transaccional dentro de su objeto de
 *    parámetros, como `tx`:
 *
 *      await this.applyHorarioEventUseCase.execute({ ..., tx });
 *
 * c) `syncLogRepository.exists` y `register` reciben el mismo `tx` como
 *    segundo argumento:
 *
 *      await this.syncLogRepository.exists(eventId, tx);
 *      await this.syncLogRepository.register({ ... }, tx);
 *
 * Los fakes de abajo aceptan el `tx` en cualquiera de esas dos formas
 * (`params.tx` o segundo argumento), así que la implementación puede elegir,
 * pero DEBE propagarlo. Si no lo propaga, las escrituras caen directamente en
 * el estado confirmado y el test de atomicidad seguirá rojo: eso es
 * exactamente lo que este archivo vigila.
 *
 * NO CUBIERTO AQUÍ (va en el paso 5 y 6 del manual, con MariaDB real):
 * el camino genérico `applyPrismaMappedEvent`, la falla de telemetría
 * `SyncClientState` posterior al commit y el rollback real del motor.
 */

import { describe, expect, it, mock } from "bun:test";
import { UploadEventsUseCase } from "./UploadEventsUseCase";
import { prisma } from "../../../infrastructure/db/prismaClient";

// ---------------------------------------------------------------------------
// Sustrato transaccional falso
// ---------------------------------------------------------------------------

type FakeTx = {
  horarios: Map<string, unknown>;
  syncLog: Map<string, unknown>;
};

/**
 * Modela la semántica de `prisma.$transaction`: lo escrito dentro de la
 * transacción vive en un staging propio y solo se fusiona al estado confirmado
 * cuando el callback resuelve sin lanzar. Si lanza, el staging se descarta.
 *
 * Sin `tx`, la escritura va directa al estado confirmado: así se comporta hoy
 * la implementación y por eso el test de atomicidad falla.
 */
class FakeStore {
  readonly horarios = new Map<string, unknown>();
  readonly syncLog = new Map<string, unknown>();

  /** Ejecutor transaccional inyectable en el caso de uso. */
  readonly runner = async <T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> => {
    const staging: FakeTx = { horarios: new Map(), syncLog: new Map() };
    const result = await fn(staging);
    for (const [k, v] of staging.horarios) this.horarios.set(k, v);
    for (const [k, v] of staging.syncLog) this.syncLog.set(k, v);
    return result;
  };

  writeHorario(tx: FakeTx | null, id: string, data: unknown) {
    (tx?.horarios ?? this.horarios).set(id, data);
  }

  writeSyncLog(tx: FakeTx | null, eventId: string, data: unknown) {
    (tx?.syncLog ?? this.syncLog).set(eventId, data);
  }

  hasSyncLog(tx: FakeTx | null, eventId: string) {
    return (tx?.syncLog.has(eventId) ?? false) || this.syncLog.has(eventId);
  }
}

/** El `tx` puede llegar en `params.tx` o como segundo argumento. */
function txFrom(params: any, second?: unknown): FakeTx | null {
  return ((second ?? params?.tx) as FakeTx) ?? null;
}

// ---------------------------------------------------------------------------
// Construcción del caso de uso
// ---------------------------------------------------------------------------

function makeDummyUseCase() {
  return { execute: mock(async () => undefined) } as any;
}

/** Posición de `applyHorarioEventUseCase` entre los 16 handlers. */
const HORARIO_INDEX = 10;

function buildUseCase(opts: {
  syncLogRepository: any;
  horarioUseCase: any;
  txRunner?: unknown;
}) {
  const handlers = Array.from({ length: 16 }, () => makeDummyUseCase());
  handlers[HORARIO_INDEX] = opts.horarioUseCase;

  // El cast permite pasar el ejecutor transaccional antes de que el
  // constructor lo declare. Retirar el `as any` cuando exista el parámetro.
  const args: unknown[] = [opts.syncLogRepository, ...handlers];
  if (opts.txRunner) args.push(opts.txRunner);

  return new (UploadEventsUseCase as any)(...args) as UploadEventsUseCase;
}

function makeEvent(n: number) {
  return {
    event_id: `demo-upload-atomicity-ev-${n}`,
    entidad: "horario",
    operacion: "INSERT",
    entidad_id: `demo-upload-atomicity-h-${n}`,
    payload: { horario_id: `demo-upload-atomicity-h-${n}`, nombre: `Turno ${n}` },
    occurred_at_utc: "2026-07-22T00:00:00.000Z",
  };
}

function makeDto(events: unknown[]) {
  return {
    device_id: "demo-upload-atomicity-device",
    gym_id: "demo-upload-atomicity-gym",
    sent_at_utc: "2026-07-22T00:05:00.000Z",
    clock_offset_ms: 0,
    gym_timezone: "America/Havana",
    events,
  } as any;
}

const EV = (n: number) => `demo-upload-atomicity-ev-${n}`;

/**
 * Ejecuta capturando la excepción. Hoy `execute` propaga el error del evento y
 * sin esta captura el test moriría antes de poder aseverar el estado de la
 * base falsa, que es justo la evidencia del defecto. Cada test exige además
 * `thrown === null`: cuando la implementación sea correcta, no debe propagar.
 */
async function runCapturing(useCase: UploadEventsUseCase, dto: unknown) {
  let res: any;
  let thrown: unknown = null;
  try {
    res = await useCase.execute(dto as any);
  } catch (error) {
    thrown = error;
  }
  return { res, thrown };
}

/** Estado confirmado, en forma comparable de un vistazo. */
function committed(store: FakeStore) {
  return {
    horarios: store.horarios.size,
    syncLog: store.syncLog.size,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UploadEventsUseCase — caracterización del lote", () => {
  it("devuelve la respuesta explícita por IDs, con processed derivado", async () => {
    const store = new FakeStore();
    const syncLogRepository = {
      exists: mock(async (id: string, tx?: unknown) =>
        store.hasSyncLog(txFrom(null, tx), id),
      ),
      register: mock(async (data: any, tx?: unknown) => {
        store.writeSyncLog(txFrom(data, tx), data.eventId, data);
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async (params: any) => {
        store.writeHorario(txFrom(params), params.entidadId, params.payload);
      }),
    } as any;

    const useCase = buildUseCase({
      syncLogRepository,
      horarioUseCase,
      txRunner: store.runner,
    });

    const res: any = await useCase.execute(makeDto([makeEvent(1), makeEvent(2)]));

    expect(res).toEqual({
      accepted_event_ids: [EV(1), EV(2)],
      duplicate_event_ids: [],
      failed_event_id: null,
      processed: 2,
    });
    expect(store.horarios.size).toBe(2);
    expect(store.syncLog.size).toBe(2);
  });

  it("clasifica un duplicado sin volver a aplicar la mutación", async () => {
    const store = new FakeStore();
    store.writeSyncLog(null, EV(1), { yaAplicado: true });

    const syncLogRepository = {
      exists: mock(async (id: string, tx?: unknown) =>
        store.hasSyncLog(txFrom(null, tx), id),
      ),
      register: mock(async (data: any, tx?: unknown) => {
        store.writeSyncLog(txFrom(data, tx), data.eventId, data);
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async (params: any) => {
        store.writeHorario(txFrom(params), params.entidadId, params.payload);
      }),
    } as any;

    const useCase = buildUseCase({
      syncLogRepository,
      horarioUseCase,
      txRunner: store.runner,
    });

    const res: any = await useCase.execute(makeDto([makeEvent(1), makeEvent(2)]));

    expect(res).toEqual({
      accepted_event_ids: [EV(2)],
      duplicate_event_ids: [EV(1)],
      failed_event_id: null,
      processed: 1,
    });
    // El duplicado no re-aplicó su entidad: solo se escribió la del evento 2.
    expect(store.horarios.size).toBe(1);
    expect(horarioUseCase.execute).toHaveBeenCalledTimes(1);
  });
});

describe("UploadEventsUseCase — detención del lote ante un fallo", () => {
  function buildFailingAt(failingEventId: string, store: FakeStore) {
    const syncLogRepository = {
      exists: mock(async (id: string, tx?: unknown) =>
        store.hasSyncLog(txFrom(null, tx), id),
      ),
      register: mock(async (data: any, tx?: unknown) => {
        store.writeSyncLog(txFrom(data, tx), data.eventId, data);
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async (params: any) => {
        if (params.eventId === failingEventId) {
          throw new Error(`Falla inyectada en ${failingEventId}`);
        }
        store.writeHorario(txFrom(params), params.entidadId, params.payload);
      }),
    } as any;

    return {
      syncLogRepository,
      horarioUseCase,
      useCase: buildUseCase({
        syncLogRepository,
        horarioUseCase,
        txRunner: store.runner,
      }),
    };
  }

  it("falla en el PRIMER evento: nada confirmado, ningún posterior procesado", async () => {
    const store = new FakeStore();
    const { useCase, horarioUseCase } = buildFailingAt(EV(1), store);

    const { res, thrown } = await runCapturing(
      useCase,
      makeDto([makeEvent(1), makeEvent(2), makeEvent(3)]),
    );

    expect(committed(store)).toEqual({ horarios: 0, syncLog: 0 });
    expect(horarioUseCase.execute).toHaveBeenCalledTimes(1);
    expect(thrown).toBeNull();
    expect(res).toEqual({
      accepted_event_ids: [],
      duplicate_event_ids: [],
      failed_event_id: EV(1),
      processed: 0,
    });
  });

  it("falla en el SEGUNDO evento: confirma el 1º, reporta el 2º, no toca el 3º", async () => {
    const store = new FakeStore();
    const { useCase, horarioUseCase } = buildFailingAt(EV(2), store);

    const { res, thrown } = await runCapturing(
      useCase,
      makeDto([makeEvent(1), makeEvent(2), makeEvent(3)]),
    );

    // El prefijo confirmado permanece; el fallido no dejó rastro.
    expect(committed(store)).toEqual({ horarios: 1, syncLog: 1 });
    expect(store.syncLog.has(EV(1))).toBe(true);
    expect(store.syncLog.has(EV(2))).toBe(false);
    expect(horarioUseCase.execute).toHaveBeenCalledTimes(2);
    expect(thrown).toBeNull();
    expect(res).toEqual({
      accepted_event_ids: [EV(1)],
      duplicate_event_ids: [],
      failed_event_id: EV(2),
      processed: 1,
    });
  });

  it("falla en el ÚLTIMO evento: confirma los dos anteriores y reporta el último", async () => {
    const store = new FakeStore();
    const { useCase, horarioUseCase } = buildFailingAt(EV(3), store);

    const { res, thrown } = await runCapturing(
      useCase,
      makeDto([makeEvent(1), makeEvent(2), makeEvent(3)]),
    );

    expect(committed(store)).toEqual({ horarios: 2, syncLog: 2 });
    expect(horarioUseCase.execute).toHaveBeenCalledTimes(3);
    expect(thrown).toBeNull();
    expect(res).toEqual({
      accepted_event_ids: [EV(1), EV(2)],
      duplicate_event_ids: [],
      failed_event_id: EV(3),
      processed: 2,
    });
  });
});

describe("UploadEventsUseCase — atomicidad entidad + sync_log", () => {
  it("defecto histórico: si falla sync_log.register, la entidad NO debe quedar escrita", async () => {
    const store = new FakeStore();

    const syncLogRepository = {
      exists: mock(async () => false),
      register: mock(async () => {
        throw new Error("Falla inyectada en sync_log.register");
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async (params: any) => {
        store.writeHorario(txFrom(params), params.entidadId, params.payload);
      }),
    } as any;

    const useCase = buildUseCase({
      syncLogRepository,
      horarioUseCase,
      txRunner: store.runner,
    });

    const { res, thrown } = await runCapturing(useCase, makeDto([makeEvent(1)]));

    // ASERCIÓN CENTRAL DE LA UNIDAD.
    // Hoy falla con { horarios: 1, syncLog: 0 }: la entidad quedó escrita sin
    // su fila de sync_log. Ese 1 es la prueba empírica del defecto.
    expect(committed(store)).toEqual({ horarios: 0, syncLog: 0 });

    // Y el caso de uso no propaga: reporta el evento como fallido.
    expect(thrown).toBeNull();
    expect(res.failed_event_id).toBe(EV(1));
    expect(res.accepted_event_ids).not.toContain(EV(1));
  });

  it("defecto simétrico: si falla la entidad, no puede quedar fila en sync_log", async () => {
    const store = new FakeStore();

    const syncLogRepository = {
      exists: mock(async () => false),
      register: mock(async (data: any, tx?: unknown) => {
        store.writeSyncLog(txFrom(data, tx), data.eventId, data);
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async () => {
        throw new Error("Falla inyectada al aplicar la entidad");
      }),
    } as any;

    const useCase = buildUseCase({
      syncLogRepository,
      horarioUseCase,
      txRunner: store.runner,
    });

    const { res, thrown } = await runCapturing(useCase, makeDto([makeEvent(1)]));

    expect(committed(store)).toEqual({ horarios: 0, syncLog: 0 });
    expect(thrown).toBeNull();
    expect(res.failed_event_id).toBe(EV(1));
  });

  it("éxito de evento único: exactamente una entidad y una fila de sync_log", async () => {
    const store = new FakeStore();

    const syncLogRepository = {
      exists: mock(async () => false),
      register: mock(async (data: any, tx?: unknown) => {
        store.writeSyncLog(txFrom(data, tx), data.eventId, data);
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async (params: any) => {
        store.writeHorario(txFrom(params), params.entidadId, params.payload);
      }),
    } as any;

    const useCase = buildUseCase({
      syncLogRepository,
      horarioUseCase,
      txRunner: store.runner,
    });

    await useCase.execute(makeDto([makeEvent(1)]));

    expect(store.horarios.size).toBe(1);
    expect(store.syncLog.size).toBe(1);
  });

  it("falla ANTES de validar: operación inválida no escribe nada", async () => {
    const store = new FakeStore();

    const syncLogRepository = {
      exists: mock(async () => false),
      register: mock(async (data: any, tx?: unknown) => {
        store.writeSyncLog(txFrom(data, tx), data.eventId, data);
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async (params: any) => {
        store.writeHorario(txFrom(params), params.entidadId, params.payload);
      }),
    } as any;

    const useCase = buildUseCase({
      syncLogRepository,
      horarioUseCase,
      txRunner: store.runner,
    });

    // `operacion` fuera de INSERT/UPDATE/DELETE: la validación lanza antes de
    // tocar la entidad o el sync_log.
    const badEvent = { ...makeEvent(1), operacion: "TRUNCATE" };
    const { res, thrown } = await runCapturing(useCase, makeDto([badEvent]));

    expect(committed(store)).toEqual({ horarios: 0, syncLog: 0 });
    expect(horarioUseCase.execute).not.toHaveBeenCalled();
    expect(thrown).toBeNull();
    expect(res.failed_event_id).toBe(EV(1));
    expect(res.accepted_event_ids).toEqual([]);
  });
});

describe("UploadEventsUseCase — telemetría posterior al commit", () => {
  it("si falla SyncClientState, los eventos ya confirmados siguen confirmados", async () => {
    const store = new FakeStore();

    const syncLogRepository = {
      exists: mock(async () => false),
      register: mock(async (data: any, tx?: unknown) => {
        store.writeSyncLog(txFrom(data, tx), data.eventId, data);
      }),
    } as any;

    const horarioUseCase = {
      execute: mock(async (params: any) => {
        store.writeHorario(txFrom(params), params.entidadId, params.payload);
      }),
    } as any;

    const useCase = buildUseCase({
      syncLogRepository,
      horarioUseCase,
      txRunner: store.runner,
    });

    // `touchSyncClientState` usa el prisma de módulo y ocurre FUERA de la
    // transacción por evento. Forzamos su fallo y exigimos que no deshaga ni
    // oculte el evento ya confirmado.
    const original = prisma.syncClientState;
    (prisma as any).syncClientState = {
      upsert: mock(async () => {
        throw new Error("Falla inyectada en SyncClientState tras el commit");
      }),
    };

    try {
      const { res, thrown } = await runCapturing(
        useCase,
        makeDto([makeEvent(1)]),
      );

      expect(thrown).toBeNull();
      expect(res.accepted_event_ids).toEqual([EV(1)]);
      expect(res.failed_event_id).toBeNull();
      expect(committed(store)).toEqual({ horarios: 1, syncLog: 1 });
    } finally {
      (prisma as any).syncClientState = original;
    }
  });
});
