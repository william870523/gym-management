import { describe, expect, test } from "bun:test";
import {
  reconcileFutureMembershipCoverage,
  type ReconciliationMembership,
} from "./membership-coverage-reconciliation";

const membership = (
  membershipId: string,
  start: string,
  endExclusive: string,
  activatedAt: string,
  overrides: Partial<ReconciliationMembership> = {},
): ReconciliationMembership => ({
  membershipId,
  start: new Date(start),
  endExclusive: new Date(endExclusive),
  activatedAt: new Date(activatedAt),
  state: "ACTIVA",
  isDeleted: false,
  trainerId: null,
  paidAmount: 10,
  contractedPrice: 10,
  ...overrides,
});

describe("membership coverage reconciliation", () => {
  test("encadena por activación las cuatro compras concurrentes", () => {
    const result = reconcileFutureMembershipCoverage({
      businessToday: new Date("2026-08-01"),
      memberships: [
        membership("local-30", "2026-08-18", "2026-09-17", "2026-08-01T07:29:28.886Z"),
        membership("local-90", "2026-09-17", "2026-12-16", "2026-08-01T07:29:29.012Z"),
        membership("web-30", "2026-08-18", "2026-09-17", "2026-08-01T07:29:29.098Z"),
        membership("web-90", "2026-09-17", "2026-12-16", "2026-08-01T07:29:29.287Z"),
      ],
    });
    expect(result.orderedMembershipIds).toEqual([
      "local-30",
      "local-90",
      "web-30",
      "web-90",
    ]);
    expect(
      result.corrections[result.corrections.length - 1]?.endExclusive.toISOString(),
    ).toBe(
      "2027-04-15T00:00:00.000Z",
    );
  });

  test("es idempotente si la cadena ya está ordenada", () => {
    const result = reconcileFutureMembershipCoverage({
      businessToday: new Date("2026-08-01"),
      memberships: [
        membership("a", "2026-08-18", "2026-09-17", "2026-08-01T07:00:00Z"),
        membership("b", "2026-09-17", "2026-10-17", "2026-08-01T08:00:00Z"),
      ],
    });
    expect(result.corrections).toEqual([]);
  });

  test("falla cerrado para cobertura consumida, entrenador o cuotas", () => {
    const run = (
      overrides: Partial<ReconciliationMembership>,
      businessToday = new Date("2026-08-01"),
    ) => reconcileFutureMembershipCoverage({
      businessToday,
      memberships: [
        membership("a", "2026-08-18", "2026-09-17", "2026-08-01T07:00:00Z"),
        membership("b", "2026-08-18", "2026-09-17", "2026-08-01T08:00:00Z", overrides),
      ],
    });
    expect(() => run({ trainerId: "trainer" })).toThrow("entrenador");
    expect(() => run({ paidAmount: 5 })).toThrow("cuotas");
    expect(() => run({}, new Date("2026-08-18"))).toThrow("ya iniciada");
  });
});
