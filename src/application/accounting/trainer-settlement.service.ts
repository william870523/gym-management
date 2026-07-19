import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  assertSettlementApplicationCount,
  assertSettlementScope,
  installmentState,
  minorUnitsToMoney,
  moneyToMinorUnits,
  normalizeFixedSettlementApplications,
  normalizeOptionalSettlementApplications,
  normalizeSettlementOperationId,
  normalizeSettlementReason,
  settlementIntentSignature,
} from "../../domain/trainer-settlement-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { FixedObligationService } from "./fixed-obligation.service";
import { TreasuryLedgerService } from "./treasury-ledger.service";

type Tx = Prisma.TransactionClient;

export class TrainerSettlementError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "TrainerSettlementError";
  }
}

export function asTrainerSettlementError(error: unknown) {
  return error instanceof TrainerSettlementError ? error : null;
}

export class TrainerSettlementService {
  private readonly fixedObligations = new FixedObligationService();
  private readonly treasuryLedger = new TreasuryLedgerService();

  async finalOffboardingPreview(
    gymId: string,
    trainerId: string,
    caseId: string,
  ) {
    return prisma.$transaction(
      (tx) => this.finalOffboardingPreviewInTx(
        tx,
        gymId,
        trainerId.trim(),
        caseId.trim(),
      ),
      { timeout: 30_000 },
    );
  }

  async createFinalOffboarding(input: {
    gymId: string;
    trainerId: string;
    caseId: string;
    currencyId: string;
    operationId: string;
    accountId: string;
    paymentTypeId: string;
    notes?: string | null;
    userId: string;
  }) {
    const operationId = this.policy(() =>
      normalizeSettlementOperationId(input.operationId)
    );
    const repeated = await prisma.entrenadorLiquidacion.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeated) {
      if (
        repeated.gym_id !== input.gymId ||
        repeated.tipo !== "BAJA_FINAL" ||
        repeated.expediente_id !== input.caseId.trim() ||
        repeated.id_entrenador !== input.trainerId.trim()
      ) {
        throw new TrainerSettlementError(
          "Ese identificador de operación ya fue usado con otros datos.",
          409,
        );
      }
      return this.receipt(input.gymId, repeated.liquidacion_id);
    }
    const preview = await this.finalOffboardingPreview(
      input.gymId,
      input.trainerId,
      input.caseId,
    );
    if (preview.estado === "EJECUTADO") {
      throw new TrainerSettlementError(
        "El expediente ya quedó liquidado y cerrado.",
        409,
      );
    }
    const group = preview.monedas.find(
      (row: any) => row.moneda_id === input.currencyId.trim(),
    );
    if (!group) {
      throw new TrainerSettlementError(
        "La moneda elegida ya no tiene saldo en la liquidación final.",
        409,
      );
    }
    return this.create({
      gymId: input.gymId,
      operationId,
      accountId: input.accountId,
      paymentTypeId: input.paymentTypeId,
      applications: group.aplicaciones.map((row: any) => ({
        cuota_id: row.referencia_id,
        monto: row.saldo_pendiente,
      })),
      fixedApplications: group.aplicaciones_fijas.map((row: any) => ({
        obligacion_id: row.referencia_id,
        monto: row.saldo_pendiente,
      })),
      notes: input.notes,
      userId: input.userId,
      settlementType: "BAJA_FINAL",
      offboardingCaseId: input.caseId,
    });
  }

  async closeFinalOffboarding(input: {
    gymId: string;
    trainerId: string;
    caseId: string;
    operationId: string;
    userId: string;
  }) {
    const operationId = this.policy(() =>
      normalizeSettlementOperationId(input.operationId)
    );
    return prisma.$transaction(async (tx) => {
      const offboardingCase = await tx.entrenadorBajaExpediente.findFirst({
        where: {
          expediente_id: input.caseId.trim(),
          id_entrenador: input.trainerId.trim(),
          gym_id: input.gymId,
          is_deleted: false,
        },
      });
      if (!offboardingCase) {
        throw new TrainerSettlementError("Expediente no encontrado.", 404);
      }
      if (offboardingCase.cierre_operacion_id) {
        if (offboardingCase.cierre_operacion_id !== operationId) {
          throw new TrainerSettlementError(
            "El expediente ya fue cerrado con otra operación.",
            409,
          );
        }
        return { cerrado: true, idempotent: true };
      }
      if (offboardingCase.estado !== "EN_EJECUCION") {
        throw new TrainerSettlementError(
          "El expediente no está pendiente de liquidación final.",
          409,
        );
      }
      const remaining = await this.finalPayablesInTx(
        tx,
        input.gymId,
        offboardingCase,
      );
      if (remaining.length) {
        throw new TrainerSettlementError(
          "Todavía existen saldos ganados. Liquide cada moneda antes de cerrar.",
          409,
        );
      }
      const now = trustedClock.nowUtc();
      const operatorName = await this.identityName(
        tx,
        input.gymId,
        input.userId,
      );
      await this.closeOffboardingCaseInTx(tx, {
        gymId: input.gymId,
        offboardingCase,
        operationId,
        userId: input.userId,
        operatorName,
        now,
      });
      return { cerrado: true, idempotent: false };
    }, { timeout: 30_000 });
  }

  async listInstallments(gymId: string, status?: string | null) {
    const requested = String(status ?? "").trim().toUpperCase();
    const stateFilter = requested === "PENDIENTE"
      ? { in: ["PENDIENTE", "PARCIAL"] }
      : requested
        ? requested
        : { in: ["PENDIENTE", "PARCIAL", "PAGADO"] };
    const installments = await prisma.entrenadorComisionCuota.findMany({
      where: {
        gym_id: gymId,
        is_deleted: false,
        estado: stateFilter,
      },
      orderBy: [{ fecha_programada: "asc" }, { cuota_id: "asc" }],
    });
    return this.enrichInstallments(prisma as unknown as Tx, gymId, installments);
  }

  async listPayables(gymId: string, status?: string | null) {
    await this.fixedObligations.materializeDue(gymId);
    const requested = String(status ?? "").trim().toUpperCase();
    const stateFilter = requested === "PENDIENTE"
      ? { in: ["PENDIENTE", "PARCIAL"] }
      : requested
        ? requested
        : { in: ["PENDIENTE", "PARCIAL", "PAGADO"] };
    const [installments, fixed] = await Promise.all([
      prisma.entrenadorComisionCuota.findMany({
        where: { gym_id: gymId, is_deleted: false, estado: stateFilter },
        orderBy: [{ fecha_programada: "asc" }, { cuota_id: "asc" }],
      }),
      prisma.entrenadorObligacionFija.findMany({
        where: { gym_id: gymId, is_deleted: false, estado: stateFilter },
        orderBy: [{ fecha_programada: "asc" }, { obligacion_id: "asc" }],
      }),
    ]);
    const [commissionRows, fixedRows] = await Promise.all([
      this.enrichInstallments(prisma as unknown as Tx, gymId, installments),
      this.enrichFixedObligations(prisma as unknown as Tx, gymId, fixed),
    ]);
    return [
      ...commissionRows.map((row) => ({
        ...row,
        origen_tipo: "COMISION",
        referencia_id: row.cuota_id,
        obligacion_id: null,
      })),
      ...fixedRows.map((row) => ({
        ...row,
        origen_tipo: "FIJO",
        referencia_id: row.obligacion_id,
        cuota_id: null,
      })),
    ].sort((a, b) => {
      const byDate = a.fecha_programada.getTime() - b.fecha_programada.getTime();
      return byDate || a.referencia_id.localeCompare(b.referencia_id);
    });
  }

  async options(gymId: string) {
    const [accounts, paymentTypes] = await Promise.all([
      prisma.cuenta.findMany({
        where: { gym_id: gymId, is_deleted: false },
        include: { moneda: true },
        orderBy: { nombre_cuenta: "asc" },
      }),
      prisma.tipoPago.findMany({
        where: { activo: true, is_deleted: false },
        orderBy: { nombre_tipo_pago: "asc" },
      }),
    ]);
    return {
      accounts: accounts.map((row) => ({
        cuenta_id: row.cuenta_id,
        nombre_cuenta: row.nombre_cuenta,
        moneda_id: row.moneda_id,
        moneda_codigo: row.moneda.codigo,
        tipo_pago_id: row.tipo_pago_id,
      })),
      payment_types: paymentTypes.map((row) => ({
        tipo_pago_id: row.tipo_pago_id,
        nombre_tipo_pago: row.nombre_tipo_pago,
        codigo: row.codigo,
      })),
    };
  }

  async list(
    gymId: string,
    input: { trainerId?: string | null; status?: string | null } = {},
  ) {
    const rows = await prisma.entrenadorLiquidacion.findMany({
      where: {
        gym_id: gymId,
        is_deleted: false,
        ...(input.trainerId ? { id_entrenador: input.trainerId } : {}),
        ...(input.status ? { estado: input.status.toUpperCase() } : {}),
      },
      orderBy: [{ pagada_at: "desc" }, { liquidacion_id: "desc" }],
      take: 100,
    });
    const trainerIds = [...new Set(rows.map((row) => row.id_entrenador))];
    const settlementIds = rows.map((row) => row.liquidacion_id);
    const [trainers, commissionApplications, fixedApplications] = await Promise.all([
      trainerIds.length
        ? prisma.entrenador.findMany({
            where: { gym_id: gymId, id_entrenador: { in: trainerIds } },
          })
        : [],
      settlementIds.length
        ? prisma.entrenadorLiquidacionAplicacion.findMany({
            where: { gym_id: gymId, liquidacion_id: { in: settlementIds } },
          })
        : [],
      settlementIds.length
        ? prisma.entrenadorLiquidacionObligacionAplicacion.findMany({
            where: { gym_id: gymId, liquidacion_id: { in: settlementIds } },
          })
        : [],
    ]);
    const trainerMap = new Map(trainers.map((row) => [
      row.id_entrenador,
      `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
    ]));
    const commissionBySettlement = this.applicationTotals(
      commissionApplications,
      (row) => row.liquidacion_id,
    );
    const fixedBySettlement = this.applicationTotals(
      fixedApplications,
      (row) => row.liquidacion_id,
    );
    return rows.map((row) => ({
      ...row,
      monto_total: this.money(row.monto_total),
      monto_comision: minorUnitsToMoney(
        commissionBySettlement.amounts.get(row.liquidacion_id) ?? 0n,
      ),
      monto_fijo: minorUnitsToMoney(
        fixedBySettlement.amounts.get(row.liquidacion_id) ?? 0n,
      ),
      conceptos_comision: commissionBySettlement.counts.get(row.liquidacion_id) ?? 0,
      conceptos_fijos: fixedBySettlement.counts.get(row.liquidacion_id) ?? 0,
      entrenador_nombre: trainerMap.get(row.id_entrenador) ?? row.id_entrenador,
    }));
  }

  async receipt(gymId: string, id: string) {
    return prisma.$transaction(
      (tx) => this.receiptInTx(tx, gymId, id.trim(), false),
      { timeout: 30_000 },
    );
  }

  async create(input: {
    gymId: string;
    operationId: string;
    accountId: string;
    paymentTypeId: string;
    applications: unknown;
    fixedApplications?: unknown;
    notes?: string | null;
    userId: string;
    settlementType?: "ORDINARIA" | "BAJA_FINAL";
    offboardingCaseId?: string | null;
  }) {
    const gymId = input.gymId;
    const operationId = this.policy(() => normalizeSettlementOperationId(input.operationId));
    const applications = this.policy(() =>
      normalizeOptionalSettlementApplications(input.applications)
    );
    const fixedApplications = this.policy(() =>
      normalizeFixedSettlementApplications(input.fixedApplications)
    );
    this.policy(() => assertSettlementApplicationCount(applications, fixedApplications));
    const accountId = String(input.accountId ?? "").trim();
    const paymentTypeId = String(input.paymentTypeId ?? "").trim();
    if (!accountId) throw new TrainerSettlementError("Seleccione la cuenta de salida.");
    if (!paymentTypeId) throw new TrainerSettlementError("Seleccione el método de salida.");
    const notes = this.notes(input.notes);
    const settlementType = input.settlementType ?? "ORDINARIA";
    const offboardingCaseId = String(input.offboardingCaseId ?? "").trim() || null;
    if (settlementType === "BAJA_FINAL" && !offboardingCaseId) {
      throw new TrainerSettlementError(
        "La liquidación final debe indicar el expediente de baja.",
      );
    }

    return prisma.$transaction(async (tx) => {
      const installmentIds = applications.map((row) => row.installmentId);
      const fixedObligationIds = fixedApplications.map((row) => row.obligationId);
      const [installments, fixedObligations] = await Promise.all([
        installmentIds.length
          ? tx.entrenadorComisionCuota.findMany({
              where: {
                cuota_id: { in: installmentIds },
                gym_id: gymId,
                is_deleted: false,
              },
            })
          : [],
        fixedObligationIds.length
          ? tx.entrenadorObligacionFija.findMany({
              where: {
                obligacion_id: { in: fixedObligationIds },
                gym_id: gymId,
                is_deleted: false,
              },
            })
          : [],
      ]);
      if (installments.length !== applications.length) {
        throw new TrainerSettlementError("Una o más cuotas no están disponibles.", 404);
      }
      if (fixedObligations.length !== fixedApplications.length) {
        throw new TrainerSettlementError(
          "Una o más obligaciones fijas no están disponibles.",
          404,
        );
      }
      const scope = this.policy(() =>
        assertSettlementScope([...installments, ...fixedObligations])
      );
      const baseIntentSignature = settlementIntentSignature({
        trainerId: scope.trainerId,
        currencyId: scope.currencyId,
        accountId,
        paymentTypeId,
        applications,
        fixedApplications,
      });
      const intentSignature = settlementType === "ORDINARIA"
        ? baseIntentSignature
        : [baseIntentSignature, settlementType, offboardingCaseId ?? ""].join("|");

      const repeated = await tx.entrenadorLiquidacion.findUnique({
        where: { operacion_id: operationId },
      });
      if (repeated) {
        if (repeated.gym_id !== gymId || repeated.intencion_firma !== intentSignature) {
          throw new TrainerSettlementError(
            "Ese identificador de operación ya fue usado con otros datos.",
            409,
          );
        }
        return this.receiptInTx(tx, gymId, repeated.liquidacion_id, true);
      }

      const now = trustedClock.nowUtc();
      const offboardingCase = settlementType === "BAJA_FINAL"
        ? await tx.entrenadorBajaExpediente.findFirst({
            where: {
              expediente_id: offboardingCaseId!,
              id_entrenador: scope.trainerId,
              gym_id: gymId,
              is_deleted: false,
            },
          })
        : null;
      if (settlementType === "BAJA_FINAL") {
        if (!offboardingCase) {
          throw new TrainerSettlementError(
            "El expediente de baja no corresponde al entrenador.",
            404,
          );
        }
        if (offboardingCase.estado !== "EN_EJECUCION") {
          throw new TrainerSettlementError(
            "El expediente ya no admite una liquidación final.",
            409,
          );
        }
      }
      if (installments.some((row) => row.estado === "ANULADO" || row.estado === "PAGADO")) {
        throw new TrainerSettlementError("La selección contiene cuotas cerradas o anuladas.", 409);
      }
      if (fixedObligations.some((row) => row.estado === "ANULADO" || row.estado === "PAGADO")) {
        throw new TrainerSettlementError(
          "La selección contiene obligaciones fijas cerradas o anuladas.",
          409,
        );
      }
      if (installments.some((row) =>
        row.fecha_programada.getTime() > now.getTime() &&
        !(
          offboardingCase &&
          row.periodo_inicio.getTime() < offboardingCase.fecha_efectiva.getTime()
        )
      )) {
        throw new TrainerSettlementError(
          "No se pueden desembolsar cuotas cuyo periodo todavía no es pagadero.",
          409,
        );
      }
      if (fixedObligations.some((row) =>
        row.fecha_programada.getTime() > now.getTime() &&
        !(
          offboardingCase &&
          row.periodo_inicio.getTime() < offboardingCase.fecha_efectiva.getTime()
        )
      )) {
        throw new TrainerSettlementError(
          "No se pueden desembolsar obligaciones fijas que todavía no son pagaderas.",
          409,
        );
      }

      const [account, paymentType, trainer, operatorName, gym] = await Promise.all([
        tx.cuenta.findFirst({
          where: { cuenta_id: accountId, gym_id: gymId, is_deleted: false },
        }),
        tx.tipoPago.findFirst({
          where: {
            tipo_pago_id: paymentTypeId,
            activo: true,
            is_deleted: false,
          },
        }),
        tx.entrenador.findFirst({
          where: {
            id_entrenador: scope.trainerId,
            gym_id: gymId,
            is_deleted: false,
          },
        }),
        this.identityName(tx, gymId, input.userId),
        tx.gym.findUnique({ where: { gym_id: gymId } }),
      ]);
      if (!account) throw new TrainerSettlementError("La cuenta de salida no está disponible.", 409);
      if (!paymentType) throw new TrainerSettlementError("El método de salida no está disponible.", 409);
      if (!trainer) throw new TrainerSettlementError("El entrenador no está disponible.", 409);
      if (account.moneda_id !== scope.currencyId) {
        throw new TrainerSettlementError("La cuenta seleccionada usa otra moneda.", 409);
      }
      if (account.tipo_pago_id && account.tipo_pago_id !== paymentTypeId) {
        throw new TrainerSettlementError("La cuenta no corresponde al método de salida.", 409);
      }

      const [existingApplications, existingFixedApplications] = await Promise.all([
        installmentIds.length
          ? tx.entrenadorLiquidacionAplicacion.findMany({
              where: {
                cuota_id: { in: installmentIds },
                gym_id: gymId,
                estado: "APLICADA",
                is_deleted: false,
              },
            })
          : [],
        fixedObligationIds.length
          ? tx.entrenadorLiquidacionObligacionAplicacion.findMany({
              where: {
                obligacion_id: { in: fixedObligationIds },
                gym_id: gymId,
                estado: "APLICADA",
                is_deleted: false,
              },
            })
          : [],
      ]);
      const paidByInstallment = new Map<string, bigint>();
      for (const row of existingApplications) {
        paidByInstallment.set(
          row.cuota_id,
          (paidByInstallment.get(row.cuota_id) ?? 0n) + moneyToMinorUnits(this.money(row.monto_aplicado)),
        );
      }
      const paidByFixedObligation = new Map<string, bigint>();
      for (const row of existingFixedApplications) {
        paidByFixedObligation.set(
          row.obligacion_id,
          (paidByFixedObligation.get(row.obligacion_id) ?? 0n) +
            moneyToMinorUnits(this.money(row.monto_aplicado)),
        );
      }
      let totalMinor = 0n;
      for (const application of applications) {
        const installment = installments.find((row) => row.cuota_id === application.installmentId)!;
        const amountMinor = moneyToMinorUnits(this.money(installment.monto));
        const paidMinor = paidByInstallment.get(installment.cuota_id) ?? 0n;
        if (application.amountMinor > amountMinor - paidMinor) {
          throw new TrainerSettlementError(
            `El monto excede el saldo de la cuota ${installment.cuota_id}.`,
            409,
          );
        }
        totalMinor += application.amountMinor;
      }
      for (const application of fixedApplications) {
        const obligation = fixedObligations.find(
          (row) => row.obligacion_id === application.obligationId,
        )!;
        const amountMinor = moneyToMinorUnits(this.money(obligation.monto));
        const paidMinor = paidByFixedObligation.get(obligation.obligacion_id) ?? 0n;
        if (application.amountMinor > amountMinor - paidMinor) {
          throw new TrainerSettlementError(
            `El monto excede el saldo de la obligación fija ${obligation.obligacion_id}.`,
            409,
          );
        }
        totalMinor += application.amountMinor;
      }

      const settlementId = randomUUID();
      const settlement = await tx.entrenadorLiquidacion.create({
        data: {
          liquidacion_id: settlementId,
          operacion_id: operationId,
          comprobante_numero: this.receiptNumber(
            now,
            gym?.timezone ?? "Etc/UTC",
            settlementId,
          ),
          intencion_firma: intentSignature,
          tipo: settlementType,
          expediente_id: offboardingCaseId,
          id_entrenador: scope.trainerId,
          moneda_id: scope.currencyId,
          cuenta_id: accountId,
          tipo_pago_id: paymentTypeId,
          monto_total: minorUnitsToMoney(totalMinor),
          estado: "PAGADA",
          notas: notes,
          pagada_por_user_id: input.userId,
          pagada_por_nombre_snapshot: operatorName,
          pagada_at: now,
          is_deleted: false,
          created_at: now,
          gym_id: gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.enqueue(tx, "entrenador_liquidacion", "INSERT", settlementId, settlement);

      const affectedAccruals = new Set<string>();
      for (const application of applications) {
        const installment = installments.find((row) => row.cuota_id === application.installmentId)!;
        const created = await tx.entrenadorLiquidacionAplicacion.create({
          data: {
            aplicacion_id: randomUUID(),
            liquidacion_id: settlementId,
            cuota_id: installment.cuota_id,
            monto_aplicado: application.amount,
            estado: "APLICADA",
            is_deleted: false,
            created_at: now,
            gym_id: gymId,
            source_device: "WEB_ADMIN",
            version: 1,
            updated_at: now,
            deleted_at: null,
          },
        });
        await this.enqueue(
          tx,
          "entrenador_liquidacion_aplicacion",
          "INSERT",
          created.aplicacion_id,
          created,
        );

        const amountMinor = moneyToMinorUnits(this.money(installment.monto));
        const newPaid = (paidByInstallment.get(installment.cuota_id) ?? 0n) + application.amountMinor;
        const nextState = installmentState(amountMinor, newPaid);
        const changed = await tx.entrenadorComisionCuota.updateMany({
          where: {
            cuota_id: installment.cuota_id,
            gym_id: gymId,
            version: installment.version,
            estado: installment.estado,
          },
          data: {
            estado: nextState,
            fecha_pago: nextState === "PAGADO" ? now : null,
            cuenta_id: nextState === "PAGADO" ? accountId : null,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        if (changed.count !== 1) {
          throw new TrainerSettlementError(
            "Otra operación modificó una cuota; actualice y vuelva a intentar.",
            409,
          );
        }
        const updated = await tx.entrenadorComisionCuota.findUniqueOrThrow({
          where: { cuota_id: installment.cuota_id },
        });
        await this.enqueue(tx, "entrenador_comision_cuota", "UPDATE", updated.cuota_id, updated);
        affectedAccruals.add(updated.devengo_id);
      }
      for (const application of fixedApplications) {
        const obligation = fixedObligations.find(
          (row) => row.obligacion_id === application.obligationId,
        )!;
        const created = await tx.entrenadorLiquidacionObligacionAplicacion.create({
          data: {
            aplicacion_id: randomUUID(),
            liquidacion_id: settlementId,
            obligacion_id: obligation.obligacion_id,
            monto_aplicado: application.amount,
            estado: "APLICADA",
            is_deleted: false,
            created_at: now,
            gym_id: gymId,
            source_device: "WEB_ADMIN",
            version: 1,
            updated_at: now,
            deleted_at: null,
          },
        });
        await this.enqueue(
          tx,
          "entrenador_liquidacion_obligacion_aplicacion",
          "INSERT",
          created.aplicacion_id,
          created,
        );
        const amountMinor = moneyToMinorUnits(this.money(obligation.monto));
        const newPaid = (paidByFixedObligation.get(obligation.obligacion_id) ?? 0n) +
          application.amountMinor;
        const nextState = installmentState(amountMinor, newPaid);
        const changed = await tx.entrenadorObligacionFija.updateMany({
          where: {
            obligacion_id: obligation.obligacion_id,
            gym_id: gymId,
            version: obligation.version,
            estado: obligation.estado,
          },
          data: {
            estado: nextState,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        if (changed.count !== 1) {
          throw new TrainerSettlementError(
            "Otra operación modificó una obligación fija; actualice y vuelva a intentar.",
            409,
          );
        }
        const updated = await tx.entrenadorObligacionFija.findUniqueOrThrow({
          where: { obligacion_id: obligation.obligacion_id },
        });
        await this.enqueue(
          tx,
          "entrenador_obligacion_fija",
          "UPDATE",
          updated.obligacion_id,
          updated,
        );
      }
      await this.refreshAccruals(tx, gymId, affectedAccruals, now);
      if (offboardingCase) {
        const remaining = await this.finalPayablesInTx(
          tx,
          gymId,
          offboardingCase,
        );
        if (!remaining.length) {
          await this.closeOffboardingCaseInTx(tx, {
            gymId,
            offboardingCase,
            operationId,
            userId: input.userId,
            operatorName,
            now,
          });
        }
      }
      await this.treasuryLedger.recordTrainerSettlementInTx(
        tx,
        gymId,
        settlement,
      );
      return this.receiptInTx(tx, gymId, settlementId, false);
    }, { timeout: 30_000 });
  }

  async reverse(input: {
    gymId: string;
    settlementId: string;
    operationId: string;
    reason: string;
    userId: string;
  }) {
    const gymId = input.gymId;
    const settlementId = String(input.settlementId ?? "").trim();
    const operationId = this.policy(() => normalizeSettlementOperationId(input.operationId));
    const reason = this.policy(() => normalizeSettlementReason(input.reason));
    if (!settlementId) throw new TrainerSettlementError("La liquidación es obligatoria.");

    return prisma.$transaction(async (tx) => {
      const repeatedOperation = await tx.entrenadorLiquidacionReversion.findUnique({
        where: { operacion_id: operationId },
      });
      if (repeatedOperation) {
        if (repeatedOperation.gym_id !== gymId || repeatedOperation.liquidacion_id !== settlementId) {
          throw new TrainerSettlementError("Esa operación de reverso ya fue usada.", 409);
        }
        return this.receiptInTx(tx, gymId, settlementId, true);
      }
      const settlement = await tx.entrenadorLiquidacion.findFirst({
        where: { liquidacion_id: settlementId, gym_id: gymId, is_deleted: false },
      });
      if (!settlement) throw new TrainerSettlementError("Liquidación no encontrada.", 404);
      const repeated = await tx.entrenadorLiquidacionReversion.findUnique({
        where: { liquidacion_id: settlementId },
      });
      if (repeated) return this.receiptInTx(tx, gymId, settlementId, true);
      if (settlement.estado !== "PAGADA") {
        throw new TrainerSettlementError("La liquidación ya no está pagada.", 409);
      }
      const closedOffboardingCase = settlement.tipo === "BAJA_FINAL" &&
          settlement.expediente_id
        ? await tx.entrenadorBajaExpediente.findFirst({
            where: {
              expediente_id: settlement.expediente_id,
              gym_id: gymId,
              is_deleted: false,
            },
          })
        : null;
      if (closedOffboardingCase?.estado === "EJECUTADO") {
        const openKey = `${gymId}:${closedOffboardingCase.id_entrenador}`;
        const conflict = await tx.entrenadorBajaExpediente.findFirst({
          where: {
            abierto_clave: openKey,
            expediente_id: { not: closedOffboardingCase.expediente_id },
          },
          select: { expediente_id: true },
        });
        if (conflict) {
          throw new TrainerSettlementError(
            "No se puede revertir: existe otro expediente abierto para el entrenador.",
            409,
          );
        }
      }

      const now = trustedClock.nowUtc();
      const [operatorName, applications, fixedApplications] = await Promise.all([
        this.identityName(tx, gymId, input.userId),
        tx.entrenadorLiquidacionAplicacion.findMany({
          where: {
            liquidacion_id: settlementId,
            gym_id: gymId,
            estado: "APLICADA",
            is_deleted: false,
          },
        }),
        tx.entrenadorLiquidacionObligacionAplicacion.findMany({
          where: {
            liquidacion_id: settlementId,
            gym_id: gymId,
            estado: "APLICADA",
            is_deleted: false,
          },
        }),
      ]);
      const changed = await tx.entrenadorLiquidacion.updateMany({
        where: {
          liquidacion_id: settlementId,
          gym_id: gymId,
          estado: "PAGADA",
          version: settlement.version,
        },
        data: { estado: "ANULADA", version: { increment: 1 }, updated_at: now },
      });
      if (changed.count !== 1) {
        throw new TrainerSettlementError("La liquidación cambió; actualice y reintente.", 409);
      }
      const updatedSettlement = await tx.entrenadorLiquidacion.findUniqueOrThrow({
        where: { liquidacion_id: settlementId },
      });
      await this.enqueue(tx, "entrenador_liquidacion", "UPDATE", settlementId, updatedSettlement);

      const affectedInstallments = new Set<string>();
      for (const application of applications) {
        const updated = await tx.entrenadorLiquidacionAplicacion.update({
          where: { aplicacion_id: application.aplicacion_id },
          data: { estado: "REVERSADA", version: { increment: 1 }, updated_at: now },
        });
        await this.enqueue(
          tx,
          "entrenador_liquidacion_aplicacion",
          "UPDATE",
          updated.aplicacion_id,
          updated,
        );
        affectedInstallments.add(updated.cuota_id);
      }

      const affectedFixedObligations = new Set<string>();
      for (const application of fixedApplications) {
        const updated = await tx.entrenadorLiquidacionObligacionAplicacion.update({
          where: { aplicacion_id: application.aplicacion_id },
          data: { estado: "REVERSADA", version: { increment: 1 }, updated_at: now },
        });
        await this.enqueue(
          tx,
          "entrenador_liquidacion_obligacion_aplicacion",
          "UPDATE",
          updated.aplicacion_id,
          updated,
        );
        affectedFixedObligations.add(updated.obligacion_id);
      }

      const affectedAccruals = new Set<string>();
      for (const installmentId of affectedInstallments) {
        const installment = await tx.entrenadorComisionCuota.findFirst({
          where: { cuota_id: installmentId, gym_id: gymId, is_deleted: false },
        });
        if (!installment || installment.estado === "ANULADO") continue;
        const active = await tx.entrenadorLiquidacionAplicacion.findMany({
          where: {
            cuota_id: installmentId,
            gym_id: gymId,
            estado: "APLICADA",
            is_deleted: false,
          },
        });
        const paidMinor = active.reduce(
          (sum, row) => sum + moneyToMinorUnits(this.money(row.monto_aplicado)),
          0n,
        );
        const nextState = installmentState(
          moneyToMinorUnits(this.money(installment.monto)),
          paidMinor,
        );
        const updated = await tx.entrenadorComisionCuota.update({
          where: { cuota_id: installmentId },
          data: {
            estado: nextState,
            fecha_pago: nextState === "PAGADO" ? installment.fecha_pago : null,
            cuenta_id: nextState === "PAGADO" ? installment.cuenta_id : null,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.enqueue(tx, "entrenador_comision_cuota", "UPDATE", updated.cuota_id, updated);
        affectedAccruals.add(updated.devengo_id);
      }
      await this.refreshAccruals(tx, gymId, affectedAccruals, now);

      for (const obligationId of affectedFixedObligations) {
        const obligation = await tx.entrenadorObligacionFija.findFirst({
          where: { obligacion_id: obligationId, gym_id: gymId, is_deleted: false },
        });
        if (!obligation || obligation.estado === "ANULADO") continue;
        const active = await tx.entrenadorLiquidacionObligacionAplicacion.findMany({
          where: {
            obligacion_id: obligationId,
            gym_id: gymId,
            estado: "APLICADA",
            is_deleted: false,
          },
        });
        const paidMinor = active.reduce(
          (sum, row) => sum + moneyToMinorUnits(this.money(row.monto_aplicado)),
          0n,
        );
        const nextState = installmentState(
          moneyToMinorUnits(this.money(obligation.monto)),
          paidMinor,
        );
        const updated = await tx.entrenadorObligacionFija.update({
          where: { obligacion_id: obligationId },
          data: {
            estado: nextState,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.enqueue(
          tx,
          "entrenador_obligacion_fija",
          "UPDATE",
          updated.obligacion_id,
          updated,
        );
      }

      const summary = {
        aplicaciones_comision_reversadas: applications.length,
        aplicaciones_fijas_reversadas: fixedApplications.length,
        aplicaciones_reversadas: applications.length + fixedApplications.length,
        cuotas_recalculadas: affectedInstallments.size,
        obligaciones_fijas_recalculadas: affectedFixedObligations.size,
        motivo: reason,
      };
      const reversal = await tx.entrenadorLiquidacionReversion.create({
        data: {
          reversion_id: randomUUID(),
          liquidacion_id: settlementId,
          operacion_id: operationId,
          motivo: reason,
          monto_total: this.money(settlement.monto_total),
          registrada_por_user_id: input.userId,
          registrada_por_nombre_snapshot: operatorName,
          registrada_at: now,
          resumen_json: JSON.stringify(summary),
          is_deleted: false,
          created_at: now,
          gym_id: gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.enqueue(
        tx,
        "entrenador_liquidacion_reversion",
        "INSERT",
        reversal.reversion_id,
        reversal,
      );
      await this.treasuryLedger.recordTrainerSettlementReversalInTx(
        tx,
        gymId,
        reversal,
      );
      if (closedOffboardingCase?.estado === "EJECUTADO") {
        const reopened = await tx.entrenadorBajaExpediente.update({
          where: { expediente_id: closedOffboardingCase.expediente_id },
          data: {
            estado: "EN_EJECUCION",
            abierto_clave: `${gymId}:${closedOffboardingCase.id_entrenador}`,
            cierre_operacion_id: null,
            cerrado_por_user_id: null,
            cerrado_por_nombre_snapshot: null,
            cerrado_at: null,
            cierre_resumen_json: null,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.enqueue(
          tx,
          "entrenador_baja_expediente",
          "UPDATE",
          reopened.expediente_id,
          reopened,
        );
      }
      return this.receiptInTx(tx, gymId, settlementId, false);
    }, { timeout: 30_000 });
  }

  private async receiptInTx(
    tx: Tx,
    gymId: string,
    settlementId: string,
    idempotent: boolean,
  ) {
    const settlement = await tx.entrenadorLiquidacion.findFirst({
      where: { liquidacion_id: settlementId, gym_id: gymId, is_deleted: false },
    });
    if (!settlement) throw new TrainerSettlementError("Liquidación no encontrada.", 404);
    const applications = await tx.entrenadorLiquidacionAplicacion.findMany({
      where: { liquidacion_id: settlementId, gym_id: gymId, is_deleted: false },
      orderBy: { created_at: "asc" },
    });
    const fixedApplications = await tx.entrenadorLiquidacionObligacionAplicacion.findMany({
      where: { liquidacion_id: settlementId, gym_id: gymId, is_deleted: false },
      orderBy: { created_at: "asc" },
    });
    const installmentIds = applications.map((row) => row.cuota_id);
    const fixedObligationIds = fixedApplications.map((row) => row.obligacion_id);
    const [
      installments,
      fixedObligations,
      trainer,
      currency,
      account,
      paymentType,
      reversal,
    ] = await Promise.all([
      installmentIds.length
        ? tx.entrenadorComisionCuota.findMany({ where: { cuota_id: { in: installmentIds } } })
        : Promise.resolve([]),
      fixedObligationIds.length
        ? tx.entrenadorObligacionFija.findMany({
            where: { obligacion_id: { in: fixedObligationIds } },
          })
        : Promise.resolve([]),
      tx.entrenador.findFirst({
        where: { id_entrenador: settlement.id_entrenador, gym_id: gymId },
      }),
      tx.moneda.findUnique({ where: { moneda_id: settlement.moneda_id } }),
      tx.cuenta.findFirst({ where: { cuenta_id: settlement.cuenta_id, gym_id: gymId } }),
      tx.tipoPago.findUnique({ where: { tipo_pago_id: settlement.tipo_pago_id } }),
      tx.entrenadorLiquidacionReversion.findUnique({ where: { liquidacion_id: settlementId } }),
    ]);
    const installmentMap = new Map(installments.map((row) => [row.cuota_id, row]));
    const fixedObligationMap = new Map(
      fixedObligations.map((row) => [row.obligacion_id, row]),
    );
    const commissionMinor = applications.reduce(
      (sum, row) => sum + moneyToMinorUnits(this.money(row.monto_aplicado)),
      0n,
    );
    const fixedMinor = fixedApplications.reduce(
      (sum, row) => sum + moneyToMinorUnits(this.money(row.monto_aplicado)),
      0n,
    );
    return {
      ...settlement,
      monto_total: this.money(settlement.monto_total),
      monto_comision: minorUnitsToMoney(commissionMinor),
      monto_fijo: minorUnitsToMoney(fixedMinor),
      conceptos_comision: applications.length,
      conceptos_fijos: fixedApplications.length,
      entrenador_nombre: trainer
        ? `${trainer.nombres_entrenador} ${trainer.apellidos_entrenador}`.trim()
        : settlement.id_entrenador,
      moneda_codigo: currency?.codigo ?? settlement.moneda_id,
      cuenta_nombre: account?.nombre_cuenta ?? settlement.cuenta_id,
      tipo_pago_nombre: paymentType?.nombre_tipo_pago ?? settlement.tipo_pago_id,
      aplicaciones: applications.map((row) => ({
        ...row,
        monto_aplicado: this.money(row.monto_aplicado),
        cuota: installmentMap.get(row.cuota_id) ?? null,
      })),
      aplicaciones_fijas: fixedApplications.map((row) => ({
        ...row,
        monto_aplicado: this.money(row.monto_aplicado),
        obligacion: fixedObligationMap.get(row.obligacion_id) ?? null,
      })),
      reversion: reversal
        ? {
            ...reversal,
            monto_total: this.money(reversal.monto_total),
            resumen: JSON.parse(reversal.resumen_json || "{}"),
          }
        : null,
      idempotent,
    };
  }

  private async enrichInstallments(tx: Tx, gymId: string, installments: any[]) {
    const ids = installments.map((row) => row.cuota_id);
    const trainerIds = [...new Set(installments.map((row) => row.id_entrenador))] as string[];
    const currencyIds = [...new Set(installments.map((row) => row.moneda_id))] as string[];
    const [applications, trainers, currencies] = await Promise.all([
      ids.length
        ? tx.entrenadorLiquidacionAplicacion.findMany({
            where: {
              cuota_id: { in: ids },
              gym_id: gymId,
              estado: "APLICADA",
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
      trainerIds.length
        ? tx.entrenador.findMany({
            where: { gym_id: gymId, id_entrenador: { in: trainerIds } },
          })
        : Promise.resolve([]),
      currencyIds.length
        ? tx.moneda.findMany({
            where: { moneda_id: { in: currencyIds }, is_deleted: false },
          })
        : Promise.resolve([]),
    ]);
    const paid = new Map<string, bigint>();
    for (const row of applications) {
      paid.set(
        row.cuota_id,
        (paid.get(row.cuota_id) ?? 0n) + moneyToMinorUnits(this.money(row.monto_aplicado)),
      );
    }
    const trainerMap = new Map(trainers.map((row) => [
      row.id_entrenador,
      `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
    ]));
    const currencyMap = new Map(currencies.map((row) => [row.moneda_id, row.codigo]));
    const now = trustedClock.nowUtc();
    return installments.map((row) => {
      const amount = moneyToMinorUnits(this.money(row.monto));
      const applied = paid.get(row.cuota_id) ?? 0n;
      return {
        ...row,
        monto: minorUnitsToMoney(amount),
        monto_aplicado: minorUnitsToMoney(applied),
        saldo_pendiente: minorUnitsToMoney(amount - applied),
        entrenador_nombre: trainerMap.get(row.id_entrenador) ?? row.id_entrenador,
        moneda_codigo: currencyMap.get(row.moneda_id) ?? row.moneda_id,
        es_pagadera: row.fecha_programada.getTime() <= now.getTime()
          && row.estado !== "PAGADO"
          && row.estado !== "ANULADO",
      };
    });
  }

  private async finalOffboardingPreviewInTx(
    tx: Tx,
    gymId: string,
    trainerId: string,
    caseId: string,
  ) {
    const offboardingCase = await tx.entrenadorBajaExpediente.findFirst({
      where: {
        expediente_id: caseId,
        id_entrenador: trainerId,
        gym_id: gymId,
        is_deleted: false,
      },
    });
    if (!offboardingCase) {
      throw new TrainerSettlementError("Expediente no encontrado.", 404);
    }
    if (!["EN_EJECUCION", "EJECUTADO"].includes(offboardingCase.estado)) {
      throw new TrainerSettlementError(
        "Primero aplique las decisiones y reasignaciones del expediente.",
        409,
      );
    }
    const trainer = await tx.entrenador.findFirst({
      where: {
        id_entrenador: trainerId,
        gym_id: gymId,
        is_deleted: false,
      },
    });
    if (!trainer) {
      throw new TrainerSettlementError("Entrenador no encontrado.", 404);
    }
    if (offboardingCase.estado === "EN_EJECUCION" && trainer.activo_entrenador) {
      throw new TrainerSettlementError(
        "El entrenador debe estar inactivo antes de emitir la liquidación final.",
        409,
      );
    }
    const payables = await this.finalPayablesInTx(tx, gymId, offboardingCase);
    const currencyIds = [...new Set(payables.map((row) => row.moneda_id))];
    const [currencies, options, settlements] = await Promise.all([
      currencyIds.length
        ? tx.moneda.findMany({
            where: { moneda_id: { in: currencyIds }, is_deleted: false },
          })
        : Promise.resolve([]),
      this.optionsInTx(tx, gymId),
      tx.entrenadorLiquidacion.findMany({
        where: {
          gym_id: gymId,
          expediente_id: caseId,
          is_deleted: false,
        },
        orderBy: [{ pagada_at: "asc" }, { liquidacion_id: "asc" }],
      }),
    ]);
    const currencyMap = new Map(
      currencies.map((row) => [row.moneda_id, row.codigo]),
    );
    const groups = new Map<string, {
      moneda_id: string;
      moneda_codigo: string;
      monto_comision_minor: bigint;
      monto_fijo_minor: bigint;
      aplicaciones: any[];
      aplicaciones_fijas: any[];
    }>();
    for (const row of payables) {
      const group = groups.get(row.moneda_id) ?? {
        moneda_id: row.moneda_id,
        moneda_codigo: currencyMap.get(row.moneda_id) ?? row.moneda_id,
        monto_comision_minor: 0n,
        monto_fijo_minor: 0n,
        aplicaciones: [],
        aplicaciones_fijas: [],
      };
      const item = {
        referencia_id: row.referencia_id,
        origen_tipo: row.origen_tipo,
        periodo_inicio: row.periodo_inicio,
        periodo_fin: row.periodo_fin,
        fecha_programada: row.fecha_programada,
        saldo_pendiente: minorUnitsToMoney(row.saldo_minor),
      };
      if (row.origen_tipo === "COMISION") {
        group.monto_comision_minor += row.saldo_minor;
        group.aplicaciones.push(item);
      } else {
        group.monto_fijo_minor += row.saldo_minor;
        group.aplicaciones_fijas.push(item);
      }
      groups.set(row.moneda_id, group);
    }
    return {
      expediente_id: offboardingCase.expediente_id,
      id_entrenador: trainerId,
      entrenador_nombre:
        `${trainer.nombres_entrenador} ${trainer.apellidos_entrenador}`.trim(),
      fecha_efectiva: offboardingCase.fecha_efectiva,
      estado: offboardingCase.estado,
      cerrado_at: offboardingCase.cerrado_at,
      monedas: [...groups.values()].map((group) => ({
        moneda_id: group.moneda_id,
        moneda_codigo: group.moneda_codigo,
        monto_comision: minorUnitsToMoney(group.monto_comision_minor),
        monto_fijo: minorUnitsToMoney(group.monto_fijo_minor),
        monto_total: minorUnitsToMoney(
          group.monto_comision_minor + group.monto_fijo_minor,
        ),
        conceptos:
          group.aplicaciones.length + group.aplicaciones_fijas.length,
        aplicaciones: group.aplicaciones,
        aplicaciones_fijas: group.aplicaciones_fijas,
      })),
      cuentas: options.accounts,
      tipos_pago: options.payment_types,
      liquidaciones: settlements.map((row) => ({
        liquidacion_id: row.liquidacion_id,
        comprobante_numero: row.comprobante_numero,
        moneda_id: row.moneda_id,
        monto_total: this.money(row.monto_total),
        estado: row.estado,
        pagada_at: row.pagada_at,
      })),
    };
  }

  private async finalPayablesInTx(
    tx: Tx,
    gymId: string,
    offboardingCase: any,
  ) {
    const [installments, fixed] = await Promise.all([
      tx.entrenadorComisionCuota.findMany({
        where: {
          gym_id: gymId,
          id_entrenador: offboardingCase.id_entrenador,
          is_deleted: false,
          estado: { in: ["PENDIENTE", "PARCIAL"] },
          periodo_inicio: { lt: offboardingCase.fecha_efectiva },
        },
        orderBy: [{ periodo_inicio: "asc" }, { cuota_id: "asc" }],
      }),
      tx.entrenadorObligacionFija.findMany({
        where: {
          gym_id: gymId,
          id_entrenador: offboardingCase.id_entrenador,
          is_deleted: false,
          estado: { in: ["PENDIENTE", "PARCIAL"] },
          periodo_inicio: { lt: offboardingCase.fecha_efectiva },
        },
        orderBy: [{ periodo_inicio: "asc" }, { obligacion_id: "asc" }],
      }),
    ]);
    const [commissionApplications, fixedApplications] = await Promise.all([
      installments.length
        ? tx.entrenadorLiquidacionAplicacion.findMany({
            where: {
              gym_id: gymId,
              cuota_id: { in: installments.map((row) => row.cuota_id) },
              estado: "APLICADA",
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
      fixed.length
        ? tx.entrenadorLiquidacionObligacionAplicacion.findMany({
            where: {
              gym_id: gymId,
              obligacion_id: { in: fixed.map((row) => row.obligacion_id) },
              estado: "APLICADA",
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
    ]);
    const paidCommission = new Map<string, bigint>();
    for (const row of commissionApplications) {
      paidCommission.set(
        row.cuota_id,
        (paidCommission.get(row.cuota_id) ?? 0n) +
          moneyToMinorUnits(this.money(row.monto_aplicado)),
      );
    }
    const paidFixed = new Map<string, bigint>();
    for (const row of fixedApplications) {
      paidFixed.set(
        row.obligacion_id,
        (paidFixed.get(row.obligacion_id) ?? 0n) +
          moneyToMinorUnits(this.money(row.monto_aplicado)),
      );
    }
    return [
      ...installments.map((row) => ({
        referencia_id: row.cuota_id,
        origen_tipo: "COMISION" as const,
        moneda_id: row.moneda_id,
        periodo_inicio: row.periodo_inicio,
        periodo_fin: row.periodo_fin,
        fecha_programada: row.fecha_programada,
        saldo_minor:
          moneyToMinorUnits(this.money(row.monto)) -
          (paidCommission.get(row.cuota_id) ?? 0n),
      })),
      ...fixed.map((row) => ({
        referencia_id: row.obligacion_id,
        origen_tipo: "FIJO" as const,
        moneda_id: row.moneda_id,
        periodo_inicio: row.periodo_inicio,
        periodo_fin: row.periodo_fin,
        fecha_programada: row.fecha_programada,
        saldo_minor:
          moneyToMinorUnits(this.money(row.monto)) -
          (paidFixed.get(row.obligacion_id) ?? 0n),
      })),
    ].filter((row) => row.saldo_minor > 0n);
  }

  private async closeOffboardingCaseInTx(
    tx: Tx,
    input: {
      gymId: string;
      offboardingCase: any;
      operationId: string;
      userId: string;
      operatorName: string;
      now: Date;
    },
  ) {
    const settlements = await tx.entrenadorLiquidacion.findMany({
      where: {
        gym_id: input.gymId,
        expediente_id: input.offboardingCase.expediente_id,
        estado: "PAGADA",
        is_deleted: false,
      },
      select: { moneda_id: true, monto_total: true, liquidacion_id: true },
    });
    const totals = new Map<string, bigint>();
    for (const row of settlements) {
      totals.set(
        row.moneda_id,
        (totals.get(row.moneda_id) ?? 0n) +
          moneyToMinorUnits(this.money(row.monto_total)),
      );
    }
    const summary = {
      liquidaciones: settlements.length,
      comprobantes: settlements.map((row) => row.liquidacion_id),
      totales_por_moneda: [...totals.entries()].map(([moneda_id, amount]) => ({
        moneda_id,
        monto: minorUnitsToMoney(amount),
      })),
      sin_saldo: settlements.length === 0,
    };
    const updated = await tx.entrenadorBajaExpediente.update({
      where: { expediente_id: input.offboardingCase.expediente_id },
      data: {
        estado: "EJECUTADO",
        abierto_clave: null,
        cierre_operacion_id: input.operationId,
        cerrado_por_user_id: input.userId,
        cerrado_por_nombre_snapshot: input.operatorName,
        cerrado_at: input.now,
        cierre_resumen_json: JSON.stringify(serialize(summary)),
        version: { increment: 1 },
        updated_at: input.now,
      },
    });
    await this.enqueue(
      tx,
      "entrenador_baja_expediente",
      "UPDATE",
      updated.expediente_id,
      updated,
    );
  }

  private async optionsInTx(tx: Tx, gymId: string) {
    const [accounts, paymentTypes] = await Promise.all([
      tx.cuenta.findMany({
        where: { gym_id: gymId, is_deleted: false },
        include: { moneda: true },
        orderBy: { nombre_cuenta: "asc" },
      }),
      tx.tipoPago.findMany({
        where: { activo: true, is_deleted: false },
        orderBy: { nombre_tipo_pago: "asc" },
      }),
    ]);
    return {
      accounts: accounts.map((row) => ({
        cuenta_id: row.cuenta_id,
        nombre_cuenta: row.nombre_cuenta,
        moneda_id: row.moneda_id,
        moneda_codigo: row.moneda.codigo,
        tipo_pago_id: row.tipo_pago_id,
      })),
      payment_types: paymentTypes.map((row) => ({
        tipo_pago_id: row.tipo_pago_id,
        nombre_tipo_pago: row.nombre_tipo_pago,
        codigo: row.codigo,
      })),
    };
  }

  private async enrichFixedObligations(tx: Tx, gymId: string, obligations: any[]) {
    const ids = obligations.map((row) => row.obligacion_id);
    const trainerIds = [...new Set(obligations.map((row) => row.id_entrenador))] as string[];
    const currencyIds = [...new Set(obligations.map((row) => row.moneda_id))] as string[];
    const [applications, trainers, currencies] = await Promise.all([
      ids.length
        ? tx.entrenadorLiquidacionObligacionAplicacion.findMany({
            where: {
              obligacion_id: { in: ids },
              gym_id: gymId,
              estado: "APLICADA",
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
      trainerIds.length
        ? tx.entrenador.findMany({
            where: { gym_id: gymId, id_entrenador: { in: trainerIds } },
          })
        : Promise.resolve([]),
      currencyIds.length
        ? tx.moneda.findMany({
            where: { moneda_id: { in: currencyIds }, is_deleted: false },
          })
        : Promise.resolve([]),
    ]);
    const paid = new Map<string, bigint>();
    for (const row of applications) {
      paid.set(
        row.obligacion_id,
        (paid.get(row.obligacion_id) ?? 0n) +
          moneyToMinorUnits(this.money(row.monto_aplicado)),
      );
    }
    const trainerMap = new Map(trainers.map((row) => [
      row.id_entrenador,
      `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
    ]));
    const currencyMap = new Map(currencies.map((row) => [row.moneda_id, row.codigo]));
    const now = trustedClock.nowUtc();
    return obligations.map((row) => {
      const amount = moneyToMinorUnits(this.money(row.monto));
      const applied = paid.get(row.obligacion_id) ?? 0n;
      return {
        ...row,
        monto: minorUnitsToMoney(amount),
        monto_aplicado: minorUnitsToMoney(applied),
        saldo_pendiente: minorUnitsToMoney(amount - applied),
        entrenador_nombre: trainerMap.get(row.id_entrenador) ?? row.id_entrenador,
        moneda_codigo: currencyMap.get(row.moneda_id) ?? row.moneda_id,
        es_pagadera: row.fecha_programada.getTime() <= now.getTime()
          && row.estado !== "PAGADO"
          && row.estado !== "ANULADO",
      };
    });
  }

  private applicationTotals(
    rows: Array<{ liquidacion_id: string; monto_aplicado: unknown }>,
    settlementId: (row: { liquidacion_id: string; monto_aplicado: unknown }) => string,
  ) {
    const amounts = new Map<string, bigint>();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const id = settlementId(row);
      amounts.set(
        id,
        (amounts.get(id) ?? 0n) + moneyToMinorUnits(this.money(row.monto_aplicado)),
      );
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return { amounts, counts };
  }

  private async refreshAccruals(
    tx: Tx,
    gymId: string,
    accrualIds: Set<string>,
    now: Date,
  ) {
    for (const accrualId of accrualIds) {
      const [accrual, installments] = await Promise.all([
        tx.entrenadorComisionDevengo.findFirst({
          where: { devengo_id: accrualId, gym_id: gymId, is_deleted: false },
        }),
        tx.entrenadorComisionCuota.findMany({
          where: { devengo_id: accrualId, gym_id: gymId, is_deleted: false },
        }),
      ]);
      if (!accrual || accrual.estado === "ANULADO") continue;
      const paidCount = installments.filter((row) => row.estado === "PAGADO").length;
      const hasPartial = installments.some((row) => row.estado === "PARCIAL");
      const state = paidCount === installments.length && installments.length > 0
        ? "PAGADO"
        : paidCount > 0 || hasPartial
          ? "PARCIAL"
          : "PENDIENTE";
      const changed = await tx.entrenadorComisionDevengo.updateMany({
        where: {
          devengo_id: accrualId,
          gym_id: gymId,
          version: accrual.version,
        },
        data: {
          cuotas_pagadas: paidCount,
          estado: state,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      if (changed.count !== 1) {
        throw new TrainerSettlementError(
          "Otra operación modificó el compromiso; actualice y vuelva a intentar.",
          409,
        );
      }
      const updated = await tx.entrenadorComisionDevengo.findUniqueOrThrow({
        where: { devengo_id: accrualId },
      });
      await this.enqueue(tx, "entrenador_comision_devengo", "UPDATE", accrualId, updated);
    }
  }

  private async identityName(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: {
        user_id: userId,
        gym_id: gymId,
        active: true,
        is_deleted: false,
      },
      select: { user_nombre: true },
    });
    if (user) return user.user_nombre;
    throw new TrainerSettlementError("La cuenta operadora no está disponible.", 403);
  }

  private receiptNumber(now: Date, timezone: string, id: string) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `LIQ-${values.year}${values.month}${values.day}-${id.slice(0, 8).toUpperCase()}`;
  }

  private notes(value: unknown) {
    const notes = String(value ?? "").trim();
    if (notes.length > 500) throw new TrainerSettlementError("Las notas exceden 500 caracteres.");
    return notes || null;
  }

  private money(value: unknown) {
    const raw = String(value ?? "0");
    return minorUnitsToMoney(moneyToMinorUnits(raw));
  }

  private policy<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw new TrainerSettlementError((error as Error).message);
    }
  }

  private async enqueue(
    tx: Tx,
    entity: string,
    operation: "INSERT" | "UPDATE" | "DELETE",
    entityId: string,
    payload: unknown,
  ) {
    const normalized = serialize(payload) as Record<string, unknown>;
    const gymId = String(normalized.gym_id ?? "").trim();
    if (!gymId) {
      throw new TrainerSettlementError("El movimiento no identifica su gimnasio.", 409);
    }
    await tx.syncLog.create({
      data: {
        event_id: randomUUID(),
        entidad: entity,
        operacion: operation,
        entidad_id: entityId,
        gym_id: gymId,
        device_id: null,
        payload_json: JSON.stringify(normalized),
      },
    });
  }
}
