import { Hono } from "hono";
import {
  CommissionRuleService,
  asCommissionRuleServiceError,
} from "../../../application/accounting/commission-rule.service";
import {
  TrainerSettlementService,
  asTrainerSettlementError,
} from "../../../application/accounting/trainer-settlement.service";
import {
  CompensationProfileService,
  asCompensationProfileServiceError,
} from "../../../application/accounting/compensation-profile.service";
import {
  FixedObligationService,
  asFixedObligationServiceError,
} from "../../../application/accounting/fixed-obligation.service";
import {
  TreasuryRefundService,
  asTreasuryRefundError,
} from "../../../application/accounting/treasury-refund.service";
import {
  TreasuryLedgerService,
  asTreasuryLedgerError,
} from "../../../application/accounting/treasury-ledger.service";
import { TreasuryCloseApprovalService } from "../../../application/accounting/treasury-close-approval.service";
import {
  TreasuryMonthCloseService,
  asTreasuryMonthCloseError,
} from "../../../application/accounting/treasury-month-close.service";
import {
  OperationalResultsService,
  asOperationalResultsServiceError,
} from "../../../application/reporting/operational-results.service";
import {
  ExchangeRevaluationService,
  asExchangeRevaluationServiceError,
} from "../../../application/reporting/exchange-revaluation.service";
import {
  MembershipRevenueService,
  asMembershipRevenueServiceError,
} from "../../../application/reporting/membership-revenue.service";
import {
  TrainerServiceCostService,
  asTrainerServiceCostServiceError,
} from "../../../application/reporting/trainer-service-cost.service";
import {
  ManagementMarginService,
  asManagementMarginServiceError,
} from "../../../application/reporting/management-margin.service";
import {
  GovernedExpenseService,
  asGovernedExpenseServiceError,
} from "../../../application/reporting/governed-expense.service";
import {
  AccrualOperatingResultService,
  asAccrualOperatingResultServiceError,
} from "../../../application/reporting/accrual-operating-result.service";
import {
  RecurringExpenseService,
  asRecurringExpenseServiceError,
} from "../../../application/accounting/recurring-expense.service";
import {
  GovernedExpenseWriteService,
  GovernedExpenseWriteServiceError,
} from "../../../application/accounting/governed-expense-write.service";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../db/prismaClient";
import { PrismaOperationalResultsReader } from "../../reporting/prisma-operational-results.reader";
import { PrismaExchangeRevaluationReader } from "../../reporting/prisma-exchange-revaluation.reader";
import { PrismaMembershipRevenueReader } from "../../reporting/prisma-membership-revenue.reader";
import { PrismaTrainerServiceCostReader } from "../../reporting/prisma-trainer-service-cost.reader";
import { PrismaManagementMarginMonthlyCloseReader } from
  "../../reporting/prisma-management-margin.reader";
import { PrismaGovernedExpenseReader } from "../../reporting/prisma-governed-expense.reader";

export const accountingRoutes = new Hono();
const commissionRules = new CommissionRuleService();
const trainerSettlements = new TrainerSettlementService();
const compensationProfiles = new CompensationProfileService();
const governedExpenseReadService = new GovernedExpenseService(
  new PrismaGovernedExpenseReader(),
);
const governedExpenseWriteService = new GovernedExpenseWriteService();
const recurringExpenses = new RecurringExpenseService();
const fixedObligations = new FixedObligationService();
const treasuryRefunds = new TreasuryRefundService();
const treasuryLedger = new TreasuryLedgerService();
const operationalResults = new OperationalResultsService(
  new PrismaOperationalResultsReader(),
);
const membershipRevenue = new MembershipRevenueService(
  new PrismaMembershipRevenueReader(),
);
const exchangeRevaluation = new ExchangeRevaluationService(
  new PrismaExchangeRevaluationReader(),
);
const trainerServiceCost = new TrainerServiceCostService(
  new PrismaTrainerServiceCostReader(),
);
const managementMargin = new ManagementMarginService(
  new PrismaMembershipRevenueReader(),
  new PrismaTrainerServiceCostReader(),
  new PrismaManagementMarginMonthlyCloseReader(),
);
const accrualOperatingResult = new AccrualOperatingResultService(
  managementMargin,
  governedExpenseReadService,
  new PrismaManagementMarginMonthlyCloseReader(),
);
const treasuryMonthCloses = new TreasuryMonthCloseService(
  operationalResults,
  managementMargin,
  governedExpenseReadService,
);

function gymIdentity(c: any) {
  const auth = c.get("auth") as
    { sub?: string; role?: string; gymId?: string } | undefined;
  return auth?.sub && auth.gymId && auth.role === "admin" ? auth : null;
}

function accountingIdentity(c: any) {
  const auth = c.get("auth") as
    { sub?: string; role?: string; gymId?: string } | undefined;
  return auth?.sub && auth.gymId && auth.role !== "device" ? auth : null;
}

function handleRuleError(c: any, error: unknown) {
  const known = asCommissionRuleServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleSettlementError(c: any, error: unknown) {
  const known = asTrainerSettlementError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleProfileError(c: any, error: unknown) {
  const known = asCompensationProfileServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleFixedObligationError(c: any, error: unknown) {
  const known = asFixedObligationServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleTreasuryRefundError(c: any, error: unknown) {
  const known = asTreasuryRefundError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleTreasuryLedgerError(c: any, error: unknown) {
  const monthClose = asTreasuryMonthCloseError(error);
  if (monthClose) return c.json({ error: monthClose.message }, monthClose.status);
  const known = asTreasuryLedgerError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleOperationalResultsError(c: any, error: unknown) {
  const known = asOperationalResultsServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleMembershipRevenueError(c: any, error: unknown) {
  const known = asMembershipRevenueServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleTrainerServiceCostError(c: any, error: unknown) {
  const known = asTrainerServiceCostServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleManagementMarginError(c: any, error: unknown) {
  const known = asManagementMarginServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleAccrualOperatingResultError(c: any, error: unknown) {
  const known = asAccrualOperatingResultServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

function handleRecurringExpenseError(c: any, error: unknown) {
  const known = asRecurringExpenseServiceError(error);
  if (known) return c.json({ error: known.message }, known.status);
  throw error;
}

accountingRoutes.get("/summary", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  const now = trustedClock.nowUtc();
  const [pending, paid, rules, profiles, fixedPending] = await Promise.all([
    trainerSettlements.listInstallments(auth.gymId, "PENDIENTE"),
    prisma.entrenadorComisionCuota.count({
      where: { gym_id: auth.gymId, estado: "PAGADO", is_deleted: false },
    }),
    commissionRules.list(auth.gymId),
    compensationProfiles.list(auth.gymId),
    fixedObligations.list(auth.gymId, "PENDIENTE"),
  ]);
  const pendingByCurrency = new Map<string, { amount: number; count: number }>();
  for (const item of pending) {
    const current = pendingByCurrency.get(item.moneda_id) ?? { amount: 0, count: 0 };
    current.amount += Number(item.saldo_pendiente);
    current.count += 1;
    pendingByCurrency.set(item.moneda_id, current);
  }
  const currentRules = rules.filter((rule) => rule.vigencia_estado === "VIGENTE");
  const scheduledRules = rules.filter((rule) => rule.vigencia_estado === "PROGRAMADA");
  const conflicts = rules.filter((rule) => rule.tiene_conflicto);
  return c.json({
    trainer_commissions: {
      pending_amount: pending.reduce((sum, item) => sum + Number(item.saldo_pendiente), 0),
      pending_count: pending.length,
      overdue_count: pending.filter((item) => item.es_pagadera && item.fecha_programada < now).length,
      paid_count: paid,
      pending_by_currency: [...pendingByCurrency.entries()].map(([moneda_id, item]) => ({
        moneda_id,
        ...item,
      })),
    },
    rules: {
      active_count: currentRules.length,
      default_count: currentRules.filter((rule) => !rule.id_entrenador).length,
      individual_count: currentRules.filter((rule) => rule.id_entrenador).length,
      scheduled_count: scheduledRules.length,
      conflict_count: conflicts.length,
    },
    fixed_payroll: {
      active_profiles: profiles.filter((profile) =>
        profile.vigencia_estado === "VIGENTE"
        && (profile.modalidad === "FIJO" || profile.modalidad === "MIXTO")
      ).length,
      pending_payments: fixedPending.length,
      pending_by_currency: Object.entries(
        fixedPending.reduce<Record<string, number>>((result, item) => {
          const code = item.moneda_codigo;
          result[code] = (result[code] ?? 0) + Number(item.monto);
          return result;
        }, {}),
      ).map(([moneda_codigo, amount]) => ({ moneda_codigo, amount })),
    },
    payout_frequencies: ["WEEKLY", "BIWEEKLY", "MONTHLY"],
  });
});

accountingRoutes.get("/trainer-installments", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  return c.json(await trainerSettlements.listInstallments(
    auth.gymId,
    c.req.query("estado"),
  ));
});

accountingRoutes.get("/trainer-fixed-obligations", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    return c.json(await fixedObligations.list(auth.gymId, c.req.query("estado")));
  } catch (error) {
    return handleFixedObligationError(c, error);
  }
});

accountingRoutes.post("/trainer-fixed-obligations/materialize", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await fixedObligations.materializeDue(auth.gymId, body.hasta_fecha));
  } catch (error) {
    return handleFixedObligationError(c, error);
  }
});

accountingRoutes.get("/trainer-compensation-profiles", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  return c.json(await compensationProfiles.list(auth.gymId));
});

accountingRoutes.post("/trainer-compensation-profiles", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  try {
    return c.json(await compensationProfiles.create(auth.gymId, await c.req.json()), 201);
  } catch (error) {
    return handleProfileError(c, error);
  }
});

accountingRoutes.put("/trainer-compensation-profiles/:id", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  try {
    return c.json(await compensationProfiles.update(
      auth.gymId,
      c.req.param("id"),
      await c.req.json(),
    ));
  } catch (error) {
    return handleProfileError(c, error);
  }
});

accountingRoutes.delete("/trainer-compensation-profiles/:id", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  try {
    return c.json(await compensationProfiles.closeOrCancel(auth.gymId, c.req.param("id")));
  } catch (error) {
    return handleProfileError(c, error);
  }
});

accountingRoutes.get("/trainer-payout-options", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  return c.json(await trainerSettlements.options(auth.gymId));
});

accountingRoutes.get("/trainer-liquidations", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  return c.json(await trainerSettlements.list(auth.gymId, {
    trainerId: c.req.query("id_entrenador"),
    status: c.req.query("estado"),
}));
});

accountingRoutes.get("/trainer-payables", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    return c.json(await trainerSettlements.listPayables(
      auth.gymId,
      c.req.query("estado"),
    ));
  } catch (error) {
    return handleFixedObligationError(c, error);
  }
});

accountingRoutes.get("/trainer-liquidations/:id", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  try {
    return c.json(await trainerSettlements.receipt(auth.gymId, c.req.param("id")));
  } catch (error) {
    return handleSettlementError(c, error);
  }
});

accountingRoutes.post("/trainer-liquidations", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  const body = await c.req.json();
  try {
    return c.json(await trainerSettlements.create({
      gymId: auth.gymId,
      operationId: body.operacion_id,
      accountId: body.cuenta_id,
      paymentTypeId: body.tipo_pago_id,
      applications: body.aplicaciones,
      fixedApplications: body.aplicaciones_fijas,
      notes: body.notas,
      userId: auth.sub!,
    }), 201);
  } catch (error) {
    return handleSettlementError(c, error);
  }
});

accountingRoutes.post("/trainer-liquidations/:id/reverse", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  const body = await c.req.json();
  try {
    return c.json(await trainerSettlements.reverse({
      gymId: auth.gymId,
      settlementId: c.req.param("id"),
      operationId: body.operacion_id,
      reason: body.motivo,
      userId: auth.sub!,
    }));
  } catch (error) {
    return handleSettlementError(c, error);
  }
});

accountingRoutes.get("/treasury-refunds", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  try {
    return c.json(await treasuryRefunds.list(auth.gymId, c.req.query("estado")));
  } catch (error) {
    return handleTreasuryRefundError(c, error);
  }
});

accountingRoutes.get("/treasury-refunds/options", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  try {
    return c.json(await treasuryRefunds.options(auth.gymId));
  } catch (error) {
    return handleTreasuryRefundError(c, error);
  }
});

accountingRoutes.get("/treasury-refunds/:id/receipt", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  try {
    return c.json(await treasuryRefunds.receipt(auth.gymId, c.req.param("id")));
  } catch (error) {
    return handleTreasuryRefundError(c, error);
  }
});

accountingRoutes.post("/treasury-refunds/:id/decision", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  const body = await c.req.json();
  try {
    return c.json(await treasuryRefunds.decide({
      gymId: auth.gymId, adjustmentId: c.req.param("id"),
      operationId: body.operacion_id, action: body.accion,
      accountId: body.cuenta_id, paymentTypeId: body.tipo_pago_id,
      reason: body.motivo, userId: auth.sub!,
    }), 201);
  } catch (error) {
    return handleTreasuryRefundError(c, error);
  }
});

accountingRoutes.post("/treasury-refunds/:id/reverse", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  const body = await c.req.json();
  try {
    return c.json(await treasuryRefunds.reverse({
      gymId: auth.gymId, refundId: c.req.param("id"),
      operationId: body.operacion_id, reason: body.motivo, userId: auth.sub!,
    }));
  } catch (error) {
    return handleTreasuryRefundError(c, error);
  }
});

accountingRoutes.get("/treasury-ledger", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica una cuenta operadora del gimnasio." }, 403);
  try {
    const approvals = new TreasuryCloseApprovalService(auth.gymId);
    const dashboard = await treasuryLedger.dashboard(auth.gymId, c.req.query("fecha"));
    return c.json(await approvals.decorateDashboard(
      dashboard,
      auth.role,
      auth.sub!,
    ));
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.get("/treasury-close-policy", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica una cuenta operadora del gimnasio." }, 403);
  }
  try {
    return c.json(await new TreasuryCloseApprovalService(auth.gymId).policy());
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.put("/treasury-close-policy", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "Se requiere una cuenta administradora del gimnasio." }, 403);
  }
  try {
    return c.json(await new TreasuryCloseApprovalService(auth.gymId)
      .updatePolicy(await c.req.json()));
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.get("/treasury-monthly-summary", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json(
      { error: "El token no identifica un gimnasio administrador." },
      403,
    );
  }
  try {
    return c.json(await treasuryMonthCloses.summary(
      auth.gymId,
      c.req.query("mes"),
      auth.sub!,
      auth.role,
    ));
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.get("/operational-results", async (c) => {
  const actor = accountingIdentity(c);
  if (!actor) return c.json({ error: "Se requiere una cuenta operadora." }, 403);
  try {
    return c.json(await operationalResults.get({
      gymId: actor.gymId!,
      month: c.req.query("mes"),
    }));
  } catch (error) {
    return handleOperationalResultsError(c, error);
  }
});

accountingRoutes.get("/operational-results/annual", async (c) => {
  const actor = accountingIdentity(c);
  if (!actor) return c.json({ error: "Se requiere una cuenta operadora." }, 403);
  try {
    return c.json(await operationalResults.getAnnual({
      gymId: actor.gymId!,
      year: c.req.query("anio"),
    }));
  } catch (error) {
    return handleOperationalResultsError(c, error);
  }
});

accountingRoutes.get("/exchange-revaluation", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    return c.json(await exchangeRevaluation.get({
      gymId: auth.gymId,
      month: c.req.query("mes"),
    }));
  } catch (error) {
    const known = asExchangeRevaluationServiceError(error);
    if (known) return c.json({ error: known.message }, known.status);
    throw error;
  }
});

accountingRoutes.get("/membership-revenue", async (c) => {
  const actor = accountingIdentity(c);
  if (!actor) return c.json({ error: "Se requiere una cuenta operadora." }, 403);
  try {
    return c.json(await membershipRevenue.get({
      gymId: actor.gymId!,
      month: c.req.query("mes"),
    }));
  } catch (error) {
    return handleMembershipRevenueError(c, error);
  }
});

accountingRoutes.get("/trainer-service-cost", async (c) => {
  const actor = accountingIdentity(c);
  if (!actor?.gymId) {
    return c.json({ error: "Se requiere una cuenta operadora." }, 403);
  }
  try {
    return c.json(await trainerServiceCost.get({
      gymId: actor.gymId,
      month: c.req.query("mes"),
    }));
  } catch (error) {
    return handleTrainerServiceCostError(c, error);
  }
});

accountingRoutes.get("/management-margin", async (c) => {
  const actor = accountingIdentity(c);
  if (!actor?.gymId) {
    return c.json({ error: "Se requiere una cuenta operadora." }, 403);
  }
  try {
    return c.json(await managementMargin.get({
      gymId: actor.gymId,
      month: c.req.query("mes"),
    }));
  } catch (error) {
    return handleManagementMarginError(c, error);
  }
});

accountingRoutes.get("/accrual-operating-result", async (c) => {
  const actor = accountingIdentity(c);
  if (!actor?.gymId) {
    return c.json({ error: "Se requiere una cuenta operadora." }, 403);
  }
  try {
    return c.json(await accrualOperatingResult.get({
      gymId: actor.gymId,
      month: c.req.query("mes"),
    }));
  } catch (error) {
    return handleAccrualOperatingResultError(c, error);
  }
});

accountingRoutes.get("/management-margin/annual", async (c) => {
  const actor = accountingIdentity(c);
  if (!actor?.gymId) {
    return c.json({ error: "Se requiere una cuenta operadora." }, 403);
  }
  try {
    return c.json(await managementMargin.getAnnual({
      gymId: actor.gymId,
      year: c.req.query("anio"),
    }));
  } catch (error) {
    return handleManagementMarginError(c, error);
  }
});

accountingRoutes.post("/treasury-monthly-closes", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica una cuenta operadora del gimnasio." }, 403);
  }
  const body = await c.req.json();
  try {
    return c.json(await treasuryMonthCloses.close({
      gymId: auth.gymId,
      month: body.mes,
      operationId: body.operacion_id,
      reason: body.motivo,
      userId: auth.sub!,
      role: auth.role,
    }), 201);
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.post("/treasury-monthly-closes/reopen", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica una cuenta operadora del gimnasio." }, 403);
  }
  const body = await c.req.json();
  try {
    return c.json(await treasuryMonthCloses.reopen({
      gymId: auth.gymId,
      month: body.mes,
      operationId: body.operacion_id,
      reason: body.motivo,
      userId: auth.sub!,
      role: auth.role,
    }));
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.get("/treasury-manual-options", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json(
      { error: "El token no identifica un gimnasio administrador." },
      403,
    );
  }
  try {
    return c.json(await treasuryLedger.manualOptions(auth.gymId));
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.post("/treasury-manual-operations", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json(
      { error: "El token no identifica un gimnasio administrador." },
      403,
    );
  }
  const body = await c.req.json();
  try {
    return c.json(await treasuryLedger.createManual({
      gymId: auth.gymId,
      operationId: body.operacion_id,
      kind: body.tipo,
      concept: body.concepto,
      description: body.descripcion,
      evidence: body.evidencia_referencia,
      amount: body.monto,
      originAccountId: body.cuenta_origen_id,
      destinationAccountId: body.cuenta_destino_id,
      originPaymentTypeId: body.tipo_pago_origen_id,
      destinationPaymentTypeId: body.tipo_pago_destino_id,
      userId: auth.sub!,
    }), 201);
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.post("/treasury-closes", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) return c.json({ error: "El token no identifica una cuenta operadora del gimnasio." }, 403);
  const body = await c.req.json();
  try {
    const approvals = new TreasuryCloseApprovalService(auth.gymId);
    const result = await approvals.submit({
      operationId: body.operacion_id,
      businessDate: body.fecha_negocio,
      accountId: body.cuenta_id,
      openingBalance: body.saldo_inicial,
      countedBalance: body.saldo_contado,
      varianceReason: body.motivo_diferencia,
      userId: auth.sub!,
      userRole: auth.role,
    });
    const dashboard = await treasuryLedger.dashboard(
      auth.gymId,
      result.businessDate.toISOString().slice(0, 10),
    );
    return c.json({
      ...await approvals.decorateDashboard(dashboard, auth.role, auth.sub!),
      resultado_arqueo: {
        estado: result.status,
        solicitud_id: result.requestId,
        cierre_id: result.closeId,
      },
    }, 201);
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.post("/treasury-close-requests/:id/decision", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica una cuenta operadora del gimnasio." }, 403);
  }
  const body = await c.req.json();
  try {
    const approvals = new TreasuryCloseApprovalService(auth.gymId);
    const result = await approvals.decide({
      requestId: c.req.param("id"),
      operationId: body.operacion_id,
      decision: body.decision,
      reason: body.motivo,
      userId: auth.sub!,
      userRole: auth.role,
    });
    const dashboard = await treasuryLedger.dashboard(
      auth.gymId,
      result.businessDate.toISOString().slice(0, 10),
    );
    return c.json({
      ...await approvals.decorateDashboard(dashboard, auth.role, auth.sub!),
      resultado_arqueo: {
        estado: result.status,
        solicitud_id: c.req.param("id"),
        cierre_id: result.closeId,
      },
    });
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.post("/treasury-reconciliations", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json(
      { error: "El token no identifica un gimnasio administrador." },
      403,
    );
  }
  const body = await c.req.json();
  try {
    return c.json(await treasuryLedger.reconcile({
      gymId: auth.gymId,
      operationId: body.operacion_id,
      closeId: body.cierre_id,
      reason: body.motivo,
      evidence: body.evidencia_referencia,
      userId: auth.sub!,
    }), 201);
  } catch (error) {
    return handleTreasuryLedgerError(c, error);
  }
});

accountingRoutes.get("/trainer-rules", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  return c.json(await commissionRules.list(auth.gymId));
});

accountingRoutes.post("/trainer-rules", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    return c.json(await commissionRules.create(auth.gymId, await c.req.json()), 201);
  } catch (error) {
    return handleRuleError(c, error);
  }
});

accountingRoutes.put("/trainer-rules/:id", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    return c.json(await commissionRules.update(
      auth.gymId,
      c.req.param("id"),
      await c.req.json(),
    ));
  } catch (error) {
    return handleRuleError(c, error);
  }
});

accountingRoutes.delete("/trainer-rules/:id", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    return c.json(await commissionRules.closeOrCancel(
      auth.gymId,
      c.req.param("id"),
    ));
  } catch (error) {
    return handleRuleError(c, error);
  }
});

function handleGovernedExpenseError(c: any, error: unknown) {
  if (error instanceof GovernedExpenseWriteServiceError) {
    return c.json({ error: error.message }, error.status);
  }
  const known = asGovernedExpenseServiceError(error);
  if (known) {
    return c.json({ error: known.message }, known.status);
  }
  return c.json({ error: (error as Error)?.message ?? "Error en gastos devengados." }, 500);
}

// R4.7 Gastos recurrentes (plantillas y generación mensual)
accountingRoutes.get("/recurring-expenses", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio." }, 403);
  }
  return c.json(await recurringExpenses.list(auth.gymId));
});

accountingRoutes.post("/recurring-expenses", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    return c.json(
      await recurringExpenses.create(auth.gymId, await c.req.json()),
      201,
    );
  } catch (error) {
    return handleRecurringExpenseError(c, error);
  }
});

accountingRoutes.put("/recurring-expenses/:id", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    const body = await c.req.json();
    return c.json(await recurringExpenses.update(auth.gymId, {
      ...body,
      recurrente_id: c.req.param("id"),
    }));
  } catch (error) {
    return handleRecurringExpenseError(c, error);
  }
});

accountingRoutes.get("/recurring-expenses/preview", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio." }, 403);
  }
  try {
    return c.json(await recurringExpenses.preview(auth.gymId, c.req.query("mes")));
  } catch (error) {
    return handleRecurringExpenseError(c, error);
  }
});

accountingRoutes.post("/recurring-expenses/generate", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio." }, 403);
  }
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await recurringExpenses.generate(auth.gymId, {
      month: body?.mes,
      userId: auth.sub ?? null,
    }));
  } catch (error) {
    return handleRecurringExpenseError(c, error);
  }
});

// R4.6 Gastos Devengados Gobernados
accountingRoutes.get("/governed-expenses", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio válido." }, 403);
  }
  const month = c.req.query("mes");
  try {
    const report = await governedExpenseReadService.get({
      gymId: auth.gymId,
      month,
    });
    return c.json(report);
  } catch (error) {
    return handleGovernedExpenseError(c, error);
  }
});

accountingRoutes.get("/governed-expense-categories", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio válido." }, 403);
  }
  return c.json(await governedExpenseWriteService.listCategories(auth.gymId));
});

accountingRoutes.post("/governed-expense-categories", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    const body = await c.req.json();
    const cat = await governedExpenseWriteService.createCategory(auth.gymId, body);
    return c.json(cat, 201);
  } catch (error) {
    return handleGovernedExpenseError(c, error);
  }
});

accountingRoutes.get("/governed-expense-suppliers", async (c) => {
  const auth = accountingIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio válido." }, 403);
  }
  return c.json(await governedExpenseWriteService.listSuppliers(auth.gymId));
});

accountingRoutes.post("/governed-expense-suppliers", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    const body = await c.req.json();
    const supplier = await governedExpenseWriteService.createSupplier(auth.gymId, body);
    return c.json(supplier, 201);
  } catch (error) {
    return handleGovernedExpenseError(c, error);
  }
});

accountingRoutes.post("/governed-expenses", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    const body = await c.req.json();
    const expense = await governedExpenseWriteService.createExpense(auth.gymId, {
      ...body,
      registrada_por_user_id: auth.sub,
    });
    return c.json(expense, 201);
  } catch (error) {
    return handleGovernedExpenseError(c, error);
  }
});

accountingRoutes.post("/governed-expenses/:id/payments", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    const body = await c.req.json();
    const result = await governedExpenseWriteService.payExpense(auth.gymId, {
      gasto_id: c.req.param("id"),
      ...body,
      registrada_por_user_id: auth.sub,
    });
    return c.json(result, 201);
  } catch (error) {
    return handleGovernedExpenseError(c, error);
  }
});

accountingRoutes.post("/governed-expense-payments/:id/reversals", async (c) => {
  const auth = gymIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "El token no identifica un gimnasio administrador." }, 403);
  }
  try {
    const body = await c.req.json();
    const result = await governedExpenseWriteService.reversePayment(auth.gymId, {
      aplicacion_id: c.req.param("id"),
      motivo: body.motivo,
      registrada_por_user_id: auth.sub,
    });
    return c.json(result, 201);
  } catch (error) {
    return handleGovernedExpenseError(c, error);
  }
});
