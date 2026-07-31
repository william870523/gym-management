import { describe, expect, it } from "bun:test";

import { waitForDatabase } from "./wait-for-database";

describe("waitForDatabase", () => {
  it("continúa inmediatamente cuando MariaDB ya está disponible", async () => {
    let checks = 0;
    let sleeps = 0;

    await waitForDatabase({
      check: async () => {
        checks += 1;
      },
      sleep: async () => {
        sleeps += 1;
      },
    });

    expect(checks).toBe(1);
    expect(sleeps).toBe(0);
  });

  it("tolera fallos transitorios del arranque de Docker", async () => {
    let checks = 0;
    let clockMs = 0;
    const retries: number[] = [];

    await waitForDatabase({
      check: async () => {
        checks += 1;
        if (checks < 3) throw new Error("MariaDB todavía no responde");
      },
      timeoutMs: 10_000,
      retryDelayMs: 2_000,
      now: () => clockMs,
      sleep: async (milliseconds) => {
        clockMs += milliseconds;
      },
      onRetry: (_error, attempt) => retries.push(attempt),
    });

    expect(checks).toBe(3);
    expect(retries).toEqual([1, 2]);
    expect(clockMs).toBe(4_000);
  });

  it("falla cerrado si MariaDB no aparece dentro del límite", async () => {
    let clockMs = 0;

    await expect(
      waitForDatabase({
        check: async () => {
          throw new Error("MariaDB no disponible");
        },
        timeoutMs: 5_000,
        retryDelayMs: 2_000,
        now: () => clockMs,
        sleep: async (milliseconds) => {
          clockMs += milliseconds;
        },
      }),
    ).rejects.toThrow("MariaDB no disponible");

    expect(clockMs).toBe(5_000);
  });
});
