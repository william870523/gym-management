import {
  addCalendarDays,
  calendarDateUtc,
  calendarDayDifference,
  isFullPayment,
} from "./membership-policy";

export interface ReconciliationMembership {
  membershipId: string;
  start: Date;
  endExclusive: Date;
  activatedAt: Date | null;
  state: string;
  isDeleted: boolean;
  trainerId: string | null;
  paidAmount: number;
  contractedPrice: number;
}

export interface MembershipCoverageCorrection {
  membershipId: string;
  start: Date;
  endExclusive: Date;
}

export interface MembershipCoverageReconciliation {
  corrections: MembershipCoverageCorrection[];
  orderedMembershipIds: string[];
}

const ACTIVE_STATES = new Set(["ACTIVA", "PENDIENTE"]);

/** Véase el contrato gemelo documentado en la API local. */
export function reconcileFutureMembershipCoverage(input: {
  memberships: ReconciliationMembership[];
  businessToday: Date;
}): MembershipCoverageReconciliation {
  const today = calendarDateUtc(input.businessToday);
  const future = input.memberships
    .filter(
      (membership) =>
        !membership.isDeleted &&
        ACTIVE_STATES.has(membership.state.toUpperCase()) &&
        membership.activatedAt !== null &&
        calendarDateUtc(membership.endExclusive).getTime() > today.getTime(),
    )
    .map((membership) => ({
      ...membership,
      start: calendarDateUtc(membership.start),
      endExclusive: calendarDateUtc(membership.endExclusive),
    }))
    .sort(
      (left, right) =>
        left.start.getTime() - right.start.getTime() ||
        left.endExclusive.getTime() - right.endExclusive.getTime() ||
        left.membershipId.localeCompare(right.membershipId),
    );

  const components: typeof future[] = [];
  let current: typeof future = [];
  let currentEnd = Number.NEGATIVE_INFINITY;
  for (const membership of future) {
    if (current.length > 0 && membership.start.getTime() > currentEnd) {
      components.push(current);
      current = [];
      currentEnd = Number.NEGATIVE_INFINITY;
    }
    current.push(membership);
    currentEnd = Math.max(currentEnd, membership.endExclusive.getTime());
  }
  if (current.length > 0) components.push(current);

  const corrections: MembershipCoverageCorrection[] = [];
  const orderedMembershipIds: string[] = [];
  for (const component of components) {
    if (component.length < 2) continue;
    const ordered = [...component].sort((left, right) => {
      const activationOrder =
        left.activatedAt!.getTime() - right.activatedAt!.getTime();
      return activationOrder || left.membershipId.localeCompare(right.membershipId);
    });
    let cursor = component[0]!.start;
    const planned = ordered.map((membership) => {
      const durationDays = calendarDayDifference(
        membership.start,
        membership.endExclusive,
      );
      if (durationDays <= 0) {
        throw new Error(
          `La membresía ${membership.membershipId} no tiene una cobertura positiva.`,
        );
      }
      const start = cursor;
      const endExclusive = addCalendarDays(start, durationDays);
      cursor = endExclusive;
      return { membership, start, endExclusive };
    });
    const changed = planned.some(
      ({ membership, start, endExclusive }) =>
        membership.start.getTime() !== start.getTime() ||
        membership.endExclusive.getTime() !== endExclusive.getTime(),
    );
    if (!changed) continue;
    for (const { membership } of planned) {
      if (membership.start.getTime() <= today.getTime()) {
        throw new Error(
          "La conciliación automática no puede mover cobertura ya iniciada.",
        );
      }
      if (membership.trainerId) {
        throw new Error(
          "La conciliación automática no puede mover una membresía con entrenador.",
        );
      }
      if (!isFullPayment(membership.paidAmount, membership.contractedPrice)) {
        throw new Error(
          "La conciliación automática no puede mover una membresía pagada por cuotas.",
        );
      }
    }
    orderedMembershipIds.push(...ordered.map((membership) => membership.membershipId));
    for (const { membership, start, endExclusive } of planned) {
      if (
        membership.start.getTime() !== start.getTime() ||
        membership.endExclusive.getTime() !== endExclusive.getTime()
      ) {
        corrections.push({ membershipId: membership.membershipId, start, endExclusive });
      }
    }
  }
  return { corrections, orderedMembershipIds };
}
