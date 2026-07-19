import { describe, expect, test } from "bun:test";
import {
  buildDemoRetentionYearScenario,
  DEMO_RETENTION_EXPECTED,
} from "../../../../scripts/demo-retention-year";

describe("remote annual retention demo contract", () => {
  test("conserva la misma matriz semántica que la instalación local", () => {
    const cases = buildDemoRetentionYearScenario();
    expect(cases).toHaveLength(DEMO_RETENTION_EXPECTED.clients);
    expect(cases.filter((item) => item.historical)).toHaveLength(DEMO_RETENTION_EXPECTED.matureEligible);
    expect(cases.filter((item) => item.trainerIndex !== null).length).toBe(48);
    expect(cases.filter((item) => item.renewalMembershipId).length).toBe(43);
  });
});
