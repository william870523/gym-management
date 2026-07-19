import { expect, test } from "bun:test";
import { normalizeRetentionManagement } from "./retention-management-policy";

test("remote retention management keeps promise date explicit", () => {
  const promise = new Date("2026-07-16T00:00:00.000Z");
  const result = normalizeRetentionManagement({
    result: "PROMESA_PAGO",
    channel: "LLAMADA",
    businessToday: new Date("2026-07-13T00:00:00.000Z"),
    promiseDate: promise,
  });
  expect(result.nextManagementDate).toEqual(promise);
});
