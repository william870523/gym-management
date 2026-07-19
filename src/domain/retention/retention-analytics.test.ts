import { describe, expect, test } from "bun:test";
import {
  filterRetentionItems,
  retentionBreakdowns,
  retentionCohorts,
  retentionDimensions,
} from "./retention-analytics";

const rows = [
  {
    expected_renewal_date: "2026-05-10",
    state: "RENOVADO_PUNTUAL",
    historical_exit: false,
    plan: { id: "p1", name: "Mensual" },
    trainer: { id: "t1", name: "Ana" },
  },
  {
    expected_renewal_date: "2026-05-20",
    state: "SALIDA",
    historical_exit: true,
    plan: { id: "p2", name: "Trimestral" },
    trainer: null,
  },
  {
    expected_renewal_date: "2026-06-12",
    state: "RENOVADO_EN_GRACIA",
    historical_exit: false,
    plan: { id: "p1", name: "Mensual" },
    trainer: { id: "t1", name: "Ana" },
  },
  {
    expected_renewal_date: "2026-06-28",
    state: "EN_GRACIA",
    historical_exit: false,
    plan: { id: "p1", name: "Mensual" },
    trainer: { id: "t2", name: "Beto" },
  },
];

describe("remote retention analytics", () => {
  test("filters the semantic population by plan and attributed trainer", () => {
    expect(filterRetentionItems(rows, { planIds: ["p1"], trainerIds: ["t1"] }))
      .toHaveLength(2);
    expect(filterRetentionItems(rows, { states: ["SALIDA"] })[0]?.plan.id)
      .toBe("p2");
  });

  test("builds stable dimensions before applying filters", () => {
    const dimensions = retentionDimensions(rows);
    expect(dimensions.plans).toEqual([
      { id: "p1", name: "Mensual", count: 3 },
      { id: "p2", name: "Trimestral", count: 1 },
    ]);
    expect(dimensions.trainers).toHaveLength(2);
  });

  test("does not treat an open cohort as consolidated", () => {
    const cohorts = retentionCohorts(rows, "2026-06-15");
    expect(cohorts[0]).toMatchObject({
      month: "2026-05",
      mature_eligible: 2,
      retained: 1,
      retention_rate_pct: 50,
      provisional: false,
    });
    expect(cohorts[1]).toMatchObject({
      month: "2026-06",
      mature_eligible: 1,
      retained: 1,
      retention_rate_pct: 100,
      retention_change_pp: 50,
      provisional: true,
    });
  });

  test("compares plans and trainers using only mature cases", () => {
    const breakdowns = retentionBreakdowns(rows, "2026-06-15");
    expect(breakdowns.plans[0]).toMatchObject({
      id: "p1",
      total_due: 3,
      mature_eligible: 2,
      open_cases: 1,
      retained: 2,
      renewed_on_time: 1,
      renewed_in_grace: 1,
      retention_rate_pct: 100,
    });
    expect(breakdowns.plans[1]).toMatchObject({
      id: "p2",
      mature_eligible: 1,
      historical_exits: 1,
      retention_rate_pct: 0,
    });
    expect(breakdowns.trainers.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(breakdowns.trainers[1]?.retention_rate_pct).toBeNull();
    expect(breakdowns.unattributed_trainer_total).toBe(1);
  });
});
