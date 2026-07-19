import {
  resolveMembershipPause,
  resolveMembershipResume,
} from "./membership-policy";

export type MembershipRequestKind = "PAUSAR" | "REANUDAR";

export function previewMembershipRequest(input: {
  kind: MembershipRequestKind;
  membershipState: string;
  membershipStart: Date;
  membershipEndExclusive: Date;
  requestedDate: Date;
  activePauseDate?: Date | null;
  activePauseRemainingDays?: number | null;
}) {
  if (input.kind === "PAUSAR") {
    if (input.membershipState !== "ACTIVA") {
      throw new Error("Solo una membresía activa puede solicitar pausa.");
    }
    const preview = resolveMembershipPause({
      membershipStart: input.membershipStart,
      membershipEndExclusive: input.membershipEndExclusive,
      effectiveDate: input.requestedDate,
    });
    return {
      remainingDays: preview.remainingDays,
      estimatedEndExclusive: preview.previousEndExclusive,
    };
  }

  if (input.membershipState !== "PAUSADA") {
    throw new Error("Solo una membresía pausada puede solicitar reanudación.");
  }
  if (!input.activePauseDate || input.activePauseRemainingDays == null) {
    throw new Error("La membresía no tiene una pausa activa verificable.");
  }
  const preview = resolveMembershipResume({
    pauseEffectiveDate: input.activePauseDate,
    resumeEffectiveDate: input.requestedDate,
    remainingDays: input.activePauseRemainingDays,
  });
  return {
    remainingDays: input.activePauseRemainingDays,
    estimatedEndExclusive: preview.newEndExclusive,
  };
}

export function assertIndependentApprover(
  requesterUserId: string,
  approverUserId: string,
) {
  if (requesterUserId === approverUserId) {
    throw new Error("La misma cuenta que solicitó no puede decidir.");
  }
}

export function isIdempotentDecision(input: {
  currentState: string;
  requestedState: "APROBADA" | "RECHAZADA";
  storedOperationId?: string | null;
  operationId: string;
}) {
  if (input.currentState === "PENDIENTE") return false;
  if (
    input.currentState === input.requestedState &&
    input.storedOperationId === input.operationId
  ) {
    return true;
  }
  throw new Error("La solicitud ya tiene una decisión diferente.");
}
