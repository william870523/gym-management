export interface RetentionAnalyticsItem {
  expected_renewal_date: string;
  state: string;
  historical_exit: boolean;
  plan: { id: string; name: string };
  trainer: { id: string; name: string } | null;
}

export interface RetentionAnalyticsFilter {
  states?: string[];
  planIds?: string[];
  trainerIds?: string[];
}

export interface RetentionBreakdownRow {
  id: string;
  name: string;
  total_due: number;
  mature_eligible: number;
  open_cases: number;
  retained: number;
  renewed_on_time: number;
  renewed_in_grace: number;
  historical_exits: number;
  recovered: number;
  retention_rate_pct: number | null;
  recovery_rate_pct: number | null;
}

export function filterRetentionItems<T extends RetentionAnalyticsItem>(
  items: T[],
  filter: RetentionAnalyticsFilter,
): T[] {
  const states = new Set(filter.states ?? []);
  const plans = new Set(filter.planIds ?? []);
  const trainers = new Set(filter.trainerIds ?? []);
  return items.filter((item) =>
    (states.size === 0 || states.has(item.state))
    && (plans.size === 0 || plans.has(item.plan.id))
    && (
      trainers.size === 0
      || (item.trainer !== null && trainers.has(item.trainer.id))
    )
  );
}

export function retentionDimensions(items: RetentionAnalyticsItem[]) {
  const plans = new Map<string, { id: string; name: string; count: number }>();
  const trainers = new Map<string, { id: string; name: string; count: number }>();
  for (const item of items) {
    const plan = plans.get(item.plan.id);
    if (plan) plan.count += 1;
    else plans.set(item.plan.id, { ...item.plan, count: 1 });
    if (item.trainer) {
      const trainer = trainers.get(item.trainer.id);
      if (trainer) trainer.count += 1;
      else trainers.set(item.trainer.id, { ...item.trainer, count: 1 });
    }
  }
  const order = <T extends { name: string }>(a: T, b: T) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  return {
    plans: [...plans.values()].sort(order),
    trainers: [...trainers.values()].sort(order),
  };
}

export function retentionBreakdowns(
  items: RetentionAnalyticsItem[],
  matureCutoff: string,
) {
  return {
    plans: aggregateBreakdown(items, matureCutoff, (item) => item.plan),
    trainers: aggregateBreakdown(
      items,
      matureCutoff,
      (item) => item.trainer,
    ),
    unattributed_trainer_total: items.filter((item) => item.trainer === null)
      .length,
  };
}

export function retentionCohorts(
  items: RetentionAnalyticsItem[],
  matureCutoff: string,
) {
  const groups = new Map<string, RetentionAnalyticsItem[]>();
  for (const item of items) {
    const month = item.expected_renewal_date.slice(0, 7);
    const rows = groups.get(month) ?? [];
    rows.push(item);
    groups.set(month, rows);
  }

  let previousMatureRate: number | null = null;
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => {
      const mature = rows.filter(
        (item) => item.expected_renewal_date <= matureCutoff,
      );
      const retained = mature.filter((item) =>
        item.state === "RENOVADO_PUNTUAL"
        || item.state === "RENOVADO_EN_GRACIA"
      ).length;
      const historicalExits = mature.filter(
        (item) => item.historical_exit,
      ).length;
      const recovered = mature.filter(
        (item) => item.state === "RECUPERADO",
      ).length;
      const retentionRate = percent(retained, mature.length);
      const recoveryRate = percent(recovered, historicalExits);
      const retentionChange = retentionRate === null || previousMatureRate === null
        ? null
        : Math.round((retentionRate - previousMatureRate) * 100) / 100;
      if (retentionRate !== null) previousMatureRate = retentionRate;
      return {
        month,
        total_due: rows.length,
        mature_eligible: mature.length,
        retained,
        historical_exits: historicalExits,
        recovered,
        retention_rate_pct: retentionRate,
        recovery_rate_pct: recoveryRate,
        retention_change_pp: retentionChange,
        provisional: rows.some(
          (item) => item.expected_renewal_date > matureCutoff,
        ),
      };
    });
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10_000) / 100;
}

function aggregateBreakdown(
  items: RetentionAnalyticsItem[],
  matureCutoff: string,
  dimension: (
    item: RetentionAnalyticsItem,
  ) => { id: string; name: string } | null,
): RetentionBreakdownRow[] {
  const groups = new Map<
    string,
    { id: string; name: string; rows: RetentionAnalyticsItem[] }
  >();
  for (const item of items) {
    const value = dimension(item);
    if (value === null) continue;
    const group = groups.get(value.id);
    if (group) group.rows.push(item);
    else groups.set(value.id, { ...value, rows: [item] });
  }

  return [...groups.values()]
    .map(({ id, name, rows }) => {
      const mature = rows.filter(
        (item) => item.expected_renewal_date <= matureCutoff,
      );
      const renewedOnTime = mature.filter(
        (item) => item.state === "RENOVADO_PUNTUAL",
      ).length;
      const renewedInGrace = mature.filter(
        (item) => item.state === "RENOVADO_EN_GRACIA",
      ).length;
      const retained = renewedOnTime + renewedInGrace;
      const historicalExits = mature.filter(
        (item) => item.historical_exit,
      ).length;
      const recovered = mature.filter(
        (item) => item.state === "RECUPERADO",
      ).length;
      return {
        id,
        name,
        total_due: rows.length,
        mature_eligible: mature.length,
        open_cases: rows.length - mature.length,
        retained,
        renewed_on_time: renewedOnTime,
        renewed_in_grace: renewedInGrace,
        historical_exits: historicalExits,
        recovered,
        retention_rate_pct: percent(retained, mature.length),
        recovery_rate_pct: percent(recovered, historicalExits),
      };
    })
    .sort((a, b) =>
      b.mature_eligible - a.mature_eligible
      || b.total_due - a.total_due
      || a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    );
}
