import { describe, expect, test } from "bun:test";
import {
  calendarDayDifference,
  isFullPayment,
  membershipCashRequired,
  resolveMembershipPause,
  resolveMembershipResume,
  resolveServicePeriod,
} from "./membership-policy";

describe("membership policy", () => {
  test("first payment does not duplicate the planned duration", () => {
    const period = resolveServicePeriod({
      plannedStart: new Date("2026-07-01T00:00:00.000Z"),
      businessToday: new Date("2026-07-12T00:00:00.000Z"),
      durationDays: 30,
    });
    expect(period.start.toISOString()).toBe("2026-07-12T00:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  test("renewal starts after the currently active period", () => {
    const period = resolveServicePeriod({
      plannedStart: new Date("2026-07-01T00:00:00.000Z"),
      activeMembershipEnd: new Date("2026-08-01T00:00:00.000Z"),
      businessToday: new Date("2026-07-12T00:00:00.000Z"),
      durationDays: 30,
    });
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  test("requires the complete contracted amount", () => {
    expect(isFullPayment(99.98, 100)).toBeFalse();
    expect(isFullPayment(100, 100)).toBeTrue();
  });

  test("internal credit reduces only the cash still required", () => {
    expect(membershipCashRequired(3000, 2000)).toBe(1000);
    expect(membershipCashRequired(3000, 3500)).toBe(0);
  });

  test("pause snapshots every unconsumed day in a semi-open period", () => {
    const pause = resolveMembershipPause({
      membershipStart: new Date("2026-07-01T00:00:00.000Z"),
      membershipEndExclusive: new Date("2026-07-31T00:00:00.000Z"),
      effectiveDate: new Date("2026-07-08T00:00:00.000Z"),
    });
    expect(pause.remainingDays).toBe(23);
  });

  test("resume preserves exactly the snapshotted service days", () => {
    const resume = resolveMembershipResume({
      pauseEffectiveDate: new Date("2026-07-08T00:00:00.000Z"),
      resumeEffectiveDate: new Date("2026-07-15T00:00:00.000Z"),
      remainingDays: 23,
    });
    expect(resume.pausedCalendarDays).toBe(7);
    expect(resume.newEndExclusive.toISOString()).toBe("2026-08-07T00:00:00.000Z");
    expect(
      calendarDayDifference(resume.effectiveDate, resume.newEndExclusive),
    ).toBe(23);
  });

  test("cannot pause at or after the exclusive end", () => {
    expect(() =>
      resolveMembershipPause({
        membershipStart: new Date("2026-07-01T00:00:00.000Z"),
        membershipEndExclusive: new Date("2026-07-31T00:00:00.000Z"),
        effectiveDate: new Date("2026-07-31T00:00:00.000Z"),
      }),
    ).toThrow("ya no tiene días");
  });
});
