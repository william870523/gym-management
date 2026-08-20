import server from "./src/infrastructure/http/server";
import { env } from "./src/config/env";
import { logger } from "./src/config/logger";
import {
    assertDatabaseUtc,
    synchronizeRemoteClock,
} from "./src/infrastructure/time/time.service";
import { waitForDatabase } from "./src/infrastructure/startup/wait-for-database";
import { registrarInstancia } from "./src/infrastructure/startup/instance-registry";
import { programarBarridoDeVisitantes } from "./src/infrastructure/startup/barrido-programado";
import { programarAuditoriaDeSellos } from "./src/infrastructure/startup/auditoria-sellos-programada";
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
const otrasInstancias = registrarInstancia({
    servicio: "gym-remote-api",
    puerto: port,
    directorioRegistro: resolve(import.meta.dir, "../.runtime"),
});

// M4a §9-bis. El barrido estaba escrito y no lo ejecutaba nadie: había que
// acordarse de lanzarlo a mano. Solo lo programa la primera instancia viva;
// dos concentradores barriendo emitirían la misma baja dos veces.
programarBarridoDeVisitantes({
    otrasInstancias: otrasInstancias.length,
    intervaloHoras: env.barridoVisitantesHoras,
    habilitado: env.barridoVisitantesHabilitado,
});

// §6.4. La puerta de la bajada comprueba lo que ENTRA; esto comprueba lo que
// ESTÁ. Un disco que se degrada o una restauración a medias no pasan por
// ninguna puerta, y hasta hoy solo se habrían notado el día que alguien
// abriera el certificado.
programarAuditoriaDeSellos({
    otrasInstancias: otrasInstancias.length,
    intervaloHoras: env.auditoriaSellosHoras,
    habilitada: env.auditoriaSellosHabilitada,
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
