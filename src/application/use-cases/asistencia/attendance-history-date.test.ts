import { describe, expect, test } from "bun:test";
import { calendarDayBoundsInZone } from "../../../config/tz";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";
import { ListAsistenciasUseCase } from "./ListAsistenciasUseCase";
import { PrismaAsistenciaRepository } from "../../../infrastructure/repositories/PrismaAsistenciaRepository";

describe("historial remoto · día de negocio y sede", () => {
  test("calcula el intervalo DST exacto", () => {
    const range = calendarDayBoundsInZone("America/Los_Angeles", "2026-03-08");
    expect(range.startUtc.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(range.endUtc.toISOString()).toBe("2026-03-09T06:59:59.999Z");
  });

  test("pasa gym, fecha, CI y página al repositorio", async () => {
    let received: unknown[] = [];
    const repository = {
      findAll: async (...args: unknown[]) => {
        received = args;
        return [];
      },
    } as unknown as AsistenciaRepository;

    await new ListAsistenciasUseCase(repository).execute(
      "gym-a",
      3,
      15,
      "CI-1",
      "2026-07-29",
    );

    expect(received).toEqual(["gym-a", 30, 15, "CI-1", "2026-07-29"]);
  });

  test("el repositorio combina sede autenticada y rango UTC", async () => {
    let query: any;
    const client = {
      gym: {
        findUnique: async () => ({ timezone: "America/Los_Angeles" }),
      },
      asistencia: {
        findMany: async (args: any) => {
          query = args;
          return [];
        },
      },
    };

    await new PrismaAsistenciaRepository(client).findAll(
      "gym-auth",
      15,
      15,
      undefined,
      "2026-08-01",
    );

    expect(query.where).toMatchObject({
      gym_id: "gym-auth",
      is_deleted: false,
      created_at: {
        gte: new Date("2026-08-01T07:00:00.000Z"),
        lte: new Date("2026-08-02T06:59:59.999Z"),
      },
    });
    expect(query.skip).toBe(15);
    expect(query.take).toBe(15);
  });
});
