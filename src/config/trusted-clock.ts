export type ClockState = "system" | "synchronized" | "adjusted" | "stale";

export interface ClockSnapshot {
  state: ClockState;
  source: string;
  system_utc: string;
  trusted_utc: string;
  clock_offset_ms: number;
  round_trip_ms: number | null;
  synchronized_at_utc: string | null;
}

interface AuthorityPayload {
  server_utc_ms?: number;
  trusted_utc_ms?: number;
  server_utc?: string;
  trusted_utc?: string;
}

const HEALTHY_OFFSET_MS = 2_000;
const STALE_AFTER_MS = 15 * 60 * 1_000;

export class TrustedClock {
  private offsetMs = 0;
  private roundTripMs: number | null = null;
  private synchronizedAtMs: number | null = null;
  private source = "system";
  private inFlight: Promise<ClockSnapshot> | null = null;

  nowUtc(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  async synchronize(url: string, timeoutMs = 5_000): Promise<ClockSnapshot> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.measure(url, timeoutMs).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async synchronizeIfDue(
    url: string,
    intervalMs: number,
    timeoutMs = 5_000,
  ): Promise<ClockSnapshot> {
    if (
      this.synchronizedAtMs !== null &&
      Date.now() - this.synchronizedAtMs < intervalMs
    ) {
      return this.snapshot();
    }
    return this.synchronize(url, timeoutMs);
  }

  snapshot(): ClockSnapshot {
    const ageMs =
      this.synchronizedAtMs === null ? null : Date.now() - this.synchronizedAtMs;
    const state: ClockState =
      this.synchronizedAtMs === null
        ? "system"
        : ageMs !== null && ageMs > STALE_AFTER_MS
          ? "stale"
          : Math.abs(this.offsetMs) > HEALTHY_OFFSET_MS
            ? "adjusted"
            : "synchronized";

    return {
      state,
      source: this.source,
      system_utc: new Date().toISOString(),
      trusted_utc: this.nowUtc().toISOString(),
      clock_offset_ms: this.offsetMs,
      round_trip_ms: this.roundTripMs,
      synchronized_at_utc:
        this.synchronizedAtMs === null
          ? null
          : new Date(this.synchronizedAtMs).toISOString(),
    };
  }

  private async measure(url: string, timeoutMs: number): Promise<ClockSnapshot> {
    const startedWallMs = Date.now();
    const startedMonotonicMs = performance.now();
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const roundTripMs = performance.now() - startedMonotonicMs;

    if (!response.ok) {
      throw new Error(`Time authority returned HTTP ${response.status}`);
    }

    let authorityMs: number | null = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as AuthorityPayload;
      authorityMs = this.parseAuthorityPayload(payload);
    }

    if (authorityMs === null) {
      const dateHeader = response.headers.get("date");
      if (dateHeader) {
        const parsed = Date.parse(dateHeader);
        if (!Number.isNaN(parsed)) authorityMs = parsed;
      }
    }

    if (authorityMs === null) {
      throw new Error("Time authority did not provide a valid UTC timestamp");
    }

    const localMidpointMs = startedWallMs + roundTripMs / 2;
    this.offsetMs = Math.round(authorityMs - localMidpointMs);
    this.roundTripMs = Math.round(roundTripMs);
    this.synchronizedAtMs = Date.now();
    this.source = url;
    return this.snapshot();
  }

  private parseAuthorityPayload(payload: AuthorityPayload): number | null {
    const numeric = payload.trusted_utc_ms ?? payload.server_utc_ms;
    if (typeof numeric === "number" && Number.isFinite(numeric)) return numeric;

    const text = payload.trusted_utc ?? payload.server_utc;
    if (typeof text !== "string") return null;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }
}

export const trustedClock = new TrustedClock();
