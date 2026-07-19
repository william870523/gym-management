import { describe, expect, test } from "bun:test";
import {
  assertIndependentApprover,
  isIdempotentDecision,
  previewMembershipRequest,
} from "./membership-request-policy";

describe("membership request policy", () => {
  test("pause request previews the exact remaining calendar days", () => {
    const preview = previewMembershipRequest({
      kind: "PAUSAR",
      membershipState: "ACTIVA",
      membershipStart: new Date("2026-07-01T00:00:00.000Z"),
      membershipEndExclusive: new Date("2026-07-31T00:00:00.000Z"),
      requestedDate: new Date("2026-07-08T00:00:00.000Z"),
    });
    expect(preview.remainingDays).toBe(23);
  });

  test("requester cannot approve their own request", () => {
    expect(() => assertIndependentApprover("user-1", "user-1")).toThrow();
  });

  test("repeating the same decision operation is idempotent", () => {
    expect(
      isIdempotentDecision({
        currentState: "RECHAZADA",
        requestedState: "RECHAZADA",
        storedOperationId: "operation-1",
        operationId: "operation-1",
      }),
    ).toBeTrue();
  });
});
