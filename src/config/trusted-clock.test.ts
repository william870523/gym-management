import { afterEach, describe, expect, test } from "bun:test";

import { TrustedClock } from "./trusted-clock";

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

describe("TrustedClock", () => {
  test("calibrates against a JSON authority using the request midpoint", async () => {
    const expectedOffsetMs = 60_000;
    server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({ server_utc_ms: Date.now() + expectedOffsetMs }),
    });

    const clock = new TrustedClock();
    const snapshot = await clock.synchronize(
      `http://127.0.0.1:${server.port}/system/time`,
    );

    expect(snapshot.state).toBe("adjusted");
    expect(snapshot.clock_offset_ms).toBeWithin(
      expectedOffsetMs - 250,
      expectedOffsetMs + 250,
    );
    expect(clock.nowUtc().getTime() - Date.now()).toBeWithin(
      expectedOffsetMs - 250,
      expectedOffsetMs + 250,
    );
  });
});
