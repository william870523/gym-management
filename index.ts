import server from "./src/infrastructure/http/server";
import { env } from "./src/config/env";
import { logger } from "./src/config/logger";
import {
    assertDatabaseUtc,
    synchronizeRemoteClock,
} from "./src/infrastructure/time/time.service";
import { waitForDatabase } from "./src/infrastructure/startup/wait-for-database";
import { registrarInstancia } from "./src/infrastructure/startup/instance-registry";
import { resolve } from "path";

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

await waitForDatabase({
    check: assertDatabaseUtc,
    onRetry: (error, attempt, remainingMs) => {
        logger.warn("MariaDB is not ready; remote API startup will retry", {
            attempt,
            remainingMs,
            error: error instanceof Error ? error.message : String(error),
        });
    },
});

setInterval(() => {
    synchronizeRemoteClock().catch((error) => {
        logger.warn("Could not refresh the remote clock", { error });
    });
}, env.timeSyncIntervalMs);

const port = server.port || 3000;

// Se apunta en el registro compartido para que `scripts/procesos-servidor.ts`
// pueda verla y cerrarla. La remota no tiene worker de sincronización, así que
// una segunda instancia no corrompe nada: solo no consigue el puerto. Por eso
// aquí se registra pero no se exige exclusividad.
registrarInstancia({
    servicio: "gym-remote-api",
    puerto: port,
    directorioRegistro: resolve(import.meta.dir, "../.runtime"),
});

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
