import { env } from "../src/config/env";
import { isValidTimeZone } from "../src/config/tz";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  assertDatabaseUtc,
  getRemoteTimeStatus,
  synchronizeRemoteClock,
} from "../src/infrastructure/time/time.service";

const failures: string[] = [];

try {
  await synchronizeRemoteClock();
} catch (error) {
  failures.push(`time authority unavailable: ${(error as Error).message}`);
}

try {
  await assertDatabaseUtc();
} catch (error) {
  failures.push((error as Error).message);
}

const status = await getRemoteTimeStatus();
if ((process.env.TZ ?? "UTC") !== "UTC") {
  failures.push(`process TZ must be UTC, got ${process.env.TZ ?? "(unset)"}`);
}
if (Math.abs(status.database_clock_drift_ms) > 5_000) {
  failures.push(
    `MariaDB clock drift is ${status.database_clock_drift_ms}ms (max 5000ms)`,
  );
}

const gyms = await prisma.gym.findMany({
  where: { deleted_at: null },
  select: { gym_id: true, timezone: true },
});
for (const gym of gyms) {
  const timezone = gym.timezone ?? env.defaultGymTimezone;
  if (!isValidTimeZone(timezone)) {
    failures.push(`gym ${gym.gym_id} has invalid timezone ${timezone}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      process_timezone: status.process_timezone,
      database_global_timezone: status.database_global_timezone,
      database_session_timezone: status.database_session_timezone,
      database_clock_drift_ms: status.database_clock_drift_ms,
      authority_offset_ms: status.clock_offset_ms,
      gyms_checked: gyms.length,
      failures,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
if (failures.length > 0) process.exit(1);
