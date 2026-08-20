/**
 * §5.2 — el rastro de la decisión sube con la entrada.
 *
 * El handler dedicado mapea campo por campo: **lo que no se nombre ahí se
 * pierde en la subida**, y la fila del concentrador quedaría distinta de la de
 * la sede que la creó. Esa diferencia no da error en ninguna parte —la entrada
 * existe en las dos bases, con la misma hora y el mismo socio— y solo la caza la
 * huella de paridad. Por eso el contrato se fija aquí.
 */
import { describe, expect, it, mock } from "bun:test";
import { ApplyAsistenciaEventUseCase } from "./ApplyAsistenciaEventUseCase";

const aplicar = async (payload: Record<string, unknown>) => {
  let guardada: any;
  const repo = {
    upsertAsistencia: mock(async (data: any) => {
      guardada = data;
    }),
    withTransaction: () => repo,
  } as any;

  await new ApplyAsistenciaEventUseCase(repo).execute({
    eventId: "ev-1",
    entidadId: "asis-1",
    operacion: "INSERT",
    gymId: "gym-visitada",
    deviceId: "device-1",
    payload: { ci: "RAS000000001", version: 1, ...payload },
  } as any);
  return guardada;
};

describe("sync de asistencia · el rastro de con qué se decidió", () => {
  it("sube tal cual lo que escribió la sede", async () => {
    const guardada = await aplicar({
      decidido_con: "COPIA_LOCAL",
      conocimiento_al_decidir: "A_CIEGAS",
      dias_sin_noticias: 3,
    });

    expect(guardada.decidido_con).toBe("COPIA_LOCAL");
    expect(guardada.conocimiento_al_decidir).toBe("A_CIEGAS");
    expect(guardada.dias_sin_noticias).toBe(3);
  });

  it("no rellena la entrada de un socio de la casa", async () => {
    // Llega sin rastro porque no aplica. Poner un valor por defecto aquí
    // afirmaría algo que nadie decidió, y encima quedaría por escrito.
    const guardada = await aplicar({});

    expect(guardada.decidido_con).toBeNull();
    expect(guardada.conocimiento_al_decidir).toBeNull();
    expect(guardada.dias_sin_noticias).toBeNull();
  });

  it("cero días es un dato, no un hueco", async () => {
    // `dias_sin_noticias: 0` es «hablé hoy». Un mapeo con `|| null` lo
    // convertiría en «no consta» por ser un cero.
    const guardada = await aplicar({
      decidido_con: "CONCENTRADOR",
      conocimiento_al_decidir: "AL_DIA",
      dias_sin_noticias: 0,
    });

    expect(guardada.dias_sin_noticias).toBe(0);
  });
});
