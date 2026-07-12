import { env } from "../../config/env";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";

interface DatabaseClockRow {
  db_now: Date;
  db_utc: Date;
  global_tz: string;
  session_tz: string;
  system_tz: string;
  session_offset_ms: bigint | number;
}

async function readDatabaseClock(): Promise<DatabaseClockRow> {
  const rows = await prisma.$queryRawUnsafe<DatabaseClockRow[]>(`
    SELECT
      NOW(6) AS db_now,
      UTC_TIMESTAMP(6) AS db_utc,
      @@global.time_zone AS global_tz,
      @@session.time_zone AS session_tz,
      @@system_time_zone AS system_tz,
      CAST(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), NOW(6)) / 1000 AS SIGNED)
        AS session_offset_ms
  `);
  if (!rows[0]) throw new Error("MariaDB did not return its clock state");
  return rows[0];
}

export async function databaseUtcNow(): Promise<Date> {
  return (await readDatabaseClock()).db_utc;
}

export async function assertDatabaseUtc(): Promise<void> {
  const database = await readDatabaseClock();
  const sessionOffsetMs = Number(database.session_offset_ms);
  if (Math.abs(sessionOffsetMs) > 1_000) {
    throw new Error(
      "MariaDB session is not UTC " +
        `(global=${database.global_tz}, session=${database.session_tz}, ` +
        `offset=${sessionOffsetMs}ms). Configure default_time_zone='+00:00'.`,
    );
  }
}

export async function synchronizeRemoteClock() {
  return trustedClock.synchronizeIfDue(
    env.timeAuthorityUrl,
    env.timeSyncIntervalMs,
    env.timeSyncTimeoutMs,
  );
}

export async function getRemoteTimeStatus(gymId?: string | null) {
  const [database, gym] = await Promise.all([
    readDatabaseClock(),
    gymId
      ? prisma.gym.findUnique({
          where: { gym_id: gymId },
          select: { timezone: true },
        })
      : Promise.resolve(null),
  ]);

  const clock = trustedClock.snapshot();
  const trustedNow = trustedClock.nowUtc();
  const databaseUtcMs = database.db_utc.getTime();

  return {
    ...clock,
    server_utc: trustedNow.toISOString(),
    server_utc_ms: trustedNow.getTime(),
    gym_id: gymId ?? null,
    gym_timezone: gym?.timezone ?? env.defaultGymTimezone,
    process_timezone: process.env.TZ ?? "UTC",
    database_utc: database.db_utc.toISOString(),
    database_now: database.db_now.toISOString(),
    database_global_timezone: database.global_tz,
    database_session_timezone: database.session_tz,
    database_system_timezone: database.system_tz,
    database_session_offset_ms: Number(database.session_offset_ms),
    database_clock_drift_ms: databaseUtcMs - trustedNow.getTime(),
  };
}
