import server from "./src/infrastructure/http/server";
import { env } from "./src/config/env";
import { logger } from "./src/config/logger";
import {
    assertDatabaseUtc,
    synchronizeRemoteClock,
} from "./src/infrastructure/time/time.service";

try {
    const clock = await synchronizeRemoteClock();
    logger.info("Remote clock calibrated", {
        state: clock.state,
        offsetMs: clock.clock_offset_ms,
        roundTripMs: clock.round_trip_ms,
    });
} catch (error) {
    logger.warn("Internet time authority unavailable; using the system clock", { error });
}

await assertDatabaseUtc();

setInterval(() => {
    synchronizeRemoteClock().catch((error) => {
        logger.warn("Could not refresh the remote clock", { error });
    });
}, env.timeSyncIntervalMs);

const port = server.port || 3000;

console.log(`Starting server on port ${port}...`);

Bun.serve({
    port: port,
    fetch: server.fetch,
    // tls: {
    //   cert: Bun.file("cert.pem"),
    //   key: Bun.file("key.pem"),
    // }
});

console.log(`Server running at http://localhost:${port}`);
