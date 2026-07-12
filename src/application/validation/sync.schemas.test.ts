import { describe, expect, test } from "bun:test";
import { ChangesQuerySchema } from "./sync.schemas";

describe("ChangesQuerySchema", () => {
  test("accepts the monotonic cursor", () => {
    const result = ChangesQuerySchema.safeParse({
      after_id: "42",
      gym_id: "gym-a",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.after_id).toBe(42);
  });

  test("keeps the legacy timestamp cursor for upgrades", () => {
    expect(
      ChangesQuerySchema.safeParse({
        since: "2026-07-06T08:00:00.000Z",
        gym_id: "gym-a",
      }).success,
    ).toBe(true);
  });

  test("requires at least one cursor", () => {
    expect(
      ChangesQuerySchema.safeParse({ gym_id: "gym-a" }).success,
    ).toBe(false);
  });
});
