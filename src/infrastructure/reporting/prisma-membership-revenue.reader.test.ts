import { describe, expect, test } from "bun:test";
import {
  isCanonicalRevenueCalendarDate,
  normalizeRevenueCalendarDate,
} from "./prisma-membership-revenue.reader";

describe("membership revenue legacy calendar normalization", () => {
  test("conserva el mismo año, mes y día sin convertir la zona del equipo", () => {
    const legacy = new Date("2026-07-13T06:25:17.350Z");
    const normalized = normalizeRevenueCalendarDate(legacy);

    expect(normalized.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(isCanonicalRevenueCalendarDate(legacy)).toBeFalse();
    expect(isCanonicalRevenueCalendarDate(normalized)).toBeTrue();
  });

  test("no desplaza una fecha que ya es contractual UTC", () => {
    const canonical = new Date("2026-09-10T00:00:00.000Z");
    expect(normalizeRevenueCalendarDate(canonical).toISOString())
      .toBe(canonical.toISOString());
    expect(isCanonicalRevenueCalendarDate(canonical)).toBeTrue();
  });
});

