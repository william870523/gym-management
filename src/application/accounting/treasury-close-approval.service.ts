import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  defaultTreasuryCloseApprovalPolicy,
  normalizeTreasuryCloseApprovalPolicy,
  normalizeTreasuryOperationId,
  normalizeTreasuryRole,
  normalizeTreasuryVarianceReason,
  parseTreasuryBusinessDate,
  treasuryCloseAmounts,
  treasuryCloseNeedsApproval,
  treasuryCloseToleranceMinor,
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
  treasuryRoleAllowed,
  TreasuryLedgerPolicyError,
  type TreasuryCloseApprovalPolicy,
} from "../../domain/treasury-ledger-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { CompensationProfileService } from "./compensation-profile.service";
import { TreasuryLedgerError } from "./treasury-ledger.service";
import { assertTreasuryMonthOpen } from "./treasury-month-lock.service";

type Tx = Prisma.TransactionClient;
type Decision = "APROBAR" | "RECHAZAR";
const POLICY_KEY = "TREASURY_CLOSE_APPROVAL_POLICY";

export class TreasuryCloseApprovalService {
  private readonly profiles = new CompensationProfileService();

  constructor(private readonly gymId: string) {}

  async policy() {
    return this.presentPolicy(await this.readPolicy());
  }

  async updatePolicy(value: unknown) {
    const policy = this.policyCall(() =>
      normalizeTreasuryCloseApprovalPolicy(value)
    );
    const now = trustedClock.nowUtc();
    await prisma.$transaction(async (tx) => {
      const existing = await tx.configuracionSistema.findUnique({
        where: { clave_gym_id: { clave: POLICY_KEY, gym_id: this.gymId } },
      });
      const id = existing?.configuracion_id ?? this.policyId();
      const row = await tx.configuracionSistema.upsert({
        where: { clave_gym_id: { clave: POLICY_KEY, gym_id: this.gymId } },
        create: {
          configuracion_id: id,
          clave: POLICY_KEY,
          valor: JSON.stringify(policy),
          descripcion:
            "Tolerancias por moneda y roles para aprobar diferencias de arqueo",
          gym_id: this.gymId,
          is_deleted: false,
          created_at: now,
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
        update: {
          valor: JSON.stringify(policy),
          descripcion:
            "Tolerancias por moneda y roles para aprobar diferencias de arqueo",
          is_deleted: false,
          version: { increment: 1 },
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.enqueue(
        tx,
        "configuracion_sistema",
        existing ? "UPDATE" : "INSERT",
        row.configuracion_id,
        row,
      );
    });
    return this.presentPolicy(policy);
  }

  async decorateDashboard(
    dashboard: Record<string, any>,
    role: unknown,
    userId: string,
  ) {
    const businessDate = parseTreasuryBusinessDate(dashboard.fecha_negocio);
    const [policy, requests] = await Promise.all([
      this.readPolicy(),
      prisma.tesoreriaCierreSolicitud.findMany({
        where: {
          gym_id: this.gymId,
          fecha_negocio: businessDate,
          is_deleted: false,
        },
        orderBy: [{ solicitada_at: "desc" }, { solicitud_id: "desc" }],
      }),
    ]);
    const pendingByAccount = new Map(
      requests
        .filter((request) => request.estado === "PENDIENTE")
        .map((request) => [request.cuenta_id, request]),
    );
    return {
      ...dashboard,
      politica_arqueo: this.presentPolicy(policy),
      capacidades_arqueo: {
        puede_solicitar: treasuryRoleAllowed(role, policy.submitterRoles),
        puede_aprobar: treasuryRoleAllowed(role, policy.approverRoles),
        permite_autoaprobacion: policy.allowSelfApproval,
        user_id: userId,
        rol: normalizeTreasuryRole(role),
      },
      solicitudes_arqueo: requests.map((request) => this.presentRequest(request)),
      cuentas: (dashboard.cuentas ?? []).map((account: Record<string, any>) => {
        const request = pendingByAccount.get(String(account.cuenta_id));
        return request
          ? {
              ...account,
              estado: "PENDIENTE_APROBACION",
              solicitud_aprobacion: this.presentRequest(request),
            }
          : account;
      }),
    };
  }

  async submit(input: {
    operationId: unknown;
    businessDate: unknown;
    accountId: unknown;
    openingBalance?: unknown;
    countedBalance: unknown;
    varianceReason?: unknown;
    userId: string;
    userRole: unknown;
  }) {
    const operationId = this.policyCall(() =>
      normalizeTreasuryOperationId(input.operationId)
    );
    const businessDate = this.policyCall(() =>
      parseTreasuryBusinessDate(input.businessDate)
    );
    const accountId = String(input.accountId ?? "").trim();
    if (!accountId) throw new TreasuryLedgerError("La cuenta es obligatoria.");
    const policy = await this.readPolicy();
    if (!treasuryRoleAllowed(input.userRole, policy.submitterRoles)) {
      throw new TreasuryLedgerError(
        "Su rol no puede registrar arqueos de Tesorería.",
        403,
      );
    }
    const repeatedRequest = await prisma.tesoreriaCierreSolicitud.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeatedRequest) {
      this.assertRepeatedRequest(repeatedRequest, businessDate, accountId);
      return {
        businessDate,
        status: repeatedRequest.estado,
        requestId: repeatedRequest.solicitud_id,
        closeId: repeatedRequest.cierre_id,
      };
    }
    const repeatedClose = await prisma.tesoreriaCierre.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeatedClose) {
      if (
        repeatedClose.gym_id !== this.gymId ||
        repeatedClose.cuenta_id !== accountId ||
        repeatedClose.fecha_negocio.getTime() !== businessDate.getTime()
      ) {
        throw new TreasuryLedgerError(
          "Ese identificador de operación ya fue usado en otro cierre.",
          409,
        );
      }
      return {
        businessDate,
        status: "CERRADO",
        requestId: repeatedClose.solicitud_id,
        closeId: repeatedClose.cierre_id,
      };
    }

    const now = trustedClock.nowUtc();
    const today = await prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, this.gymId, now)
    );
    if (businessDate > today) {
      throw new TreasuryLedgerError(
        "No se puede cerrar una fecha comercial futura.",
        409,
      );
    }

    return prisma.$transaction(async (tx) => {
      await assertTreasuryMonthOpen(tx, this.gymId, businessDate);
      const context = await this.closeContext(
        tx,
        businessDate,
        accountId,
        input.openingBalance,
        input.countedBalance,
      );
      const toleranceMinor = treasuryCloseToleranceMinor(
        policy,
        context.account.moneda_id,
      );
      const needsApproval = treasuryCloseNeedsApproval(
        context.amounts.differenceMinor,
        toleranceMinor,
      );
      const reason = this.policyCall(() =>
        normalizeTreasuryVarianceReason(
          input.varianceReason,
          needsApproval && policy.requireReasonForDifference,
        )
      );
      if (!needsApproval) {
        const close = await this.createClose(tx, {
          operationId,
          businessDate,
          account: context.account,
          movements: context.movements,
          amounts: context.amounts,
          userId: input.userId,
          toleranceMinor,
          reason,
          approvalState:
            context.amounts.differenceMinor === 0n
              ? "NO_REQUERIDA"
              : "DENTRO_TOLERANCIA",
          now,
        });
        return {
          businessDate,
          status: "CERRADO",
          requestId: null,
          closeId: close.cierre_id,
        };
      }

      const pendingKey = this.closeKey(businessDate, accountId);
      const pending = await tx.tesoreriaCierreSolicitud.findFirst({
        where: { pendiente_clave: pendingKey, estado: "PENDIENTE" },
      });
      if (pending) {
        throw new TreasuryLedgerError(
          "Esta cuenta ya tiene un arqueo esperando aprobación.",
          409,
        );
      }
      const operatorName = await this.identityName(tx, input.userId);
      const requestId = randomUUID();
      const movementIds = context.movements.map((row) => row.movimiento_id);
      const signature = this.intentSignature({
        businessDate,
        accountId,
        opening: context.amounts.opening,
        counted: context.amounts.counted,
        movementIds,
        reason,
      });
      const snapshot = this.snapshot({
        businessDate,
        account: context.account,
        movements: context.movements,
        amounts: context.amounts,
        toleranceMinor,
        reason,
      });
      const request = await tx.tesoreriaCierreSolicitud.create({
        data: {
          solicitud_id: requestId,
          operacion_id: operationId,
          decision_operacion_id: null,
          intencion_firma: signature,
          pendiente_clave: pendingKey,
          fecha_negocio: businessDate,
          cuenta_id: accountId,
          moneda_id: context.account.moneda_id,
          saldo_inicial: context.amounts.opening,
          total_entradas: treasuryMinorToMoney(context.entriesMinor),
          total_salidas: treasuryMinorToMoney(context.exitsMinor),
          saldo_esperado: context.amounts.expected,
          saldo_contado: context.amounts.counted,
          diferencia: context.amounts.difference,
          tolerancia_aplicada: treasuryMinorToMoney(toleranceMinor),
          movimientos_cantidad: context.movements.length,
          movimientos_hasta_at: context.lastMovementAt,
          movimiento_ids_json: JSON.stringify(movementIds),
          motivo: reason ?? "Diferencia fuera de tolerancia",
          estado: "PENDIENTE",
          solicitada_por_user_id: input.userId,
          solicitada_por_nombre_snapshot: operatorName,
          solicitada_por_rol_snapshot: normalizeTreasuryRole(input.userRole),
          solicitada_at: now,
          decidida_por_user_id: null,
          decidida_por_nombre_snapshot: null,
          decidida_por_rol_snapshot: null,
          decision_motivo: null,
          decidida_at: null,
          cierre_id: null,
          politica_snapshot_json: JSON.stringify(policy),
          snapshot_json: JSON.stringify(snapshot),
          is_deleted: false,
          created_at: now,
          gym_id: this.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.enqueue(
        tx,
        "tesoreria_cierre_solicitud",
        "INSERT",
        request.solicitud_id,
        request,
        operationId,
      );
      return {
        businessDate,
        status: "PENDIENTE",
        requestId,
        closeId: null,
      };
    }, { timeout: 30_000 });
  }

  async decide(input: {
    requestId: string;
    operationId: unknown;
    decision: unknown;
    reason?: unknown;
    userId: string;
    userRole: unknown;
  }) {
    const requestId = String(input.requestId ?? "").trim();
    if (!requestId) throw new TreasuryLedgerError("La solicitud es obligatoria.");
    const operationId = this.policyCall(() =>
      normalizeTreasuryOperationId(input.operationId)
    );
    const decision = String(input.decision ?? "").trim().toUpperCase() as Decision;
    if (decision !== "APROBAR" && decision !== "RECHAZAR") {
      throw new TreasuryLedgerError("Seleccione aprobar o rechazar.");
    }
    const policy = await this.readPolicy();
    if (!treasuryRoleAllowed(input.userRole, policy.approverRoles)) {
      throw new TreasuryLedgerError(
        "Su rol no puede aprobar diferencias de arqueo.",
        403,
      );
    }
    const decisionReason = this.policyCall(() =>
      normalizeTreasuryVarianceReason(input.reason, decision === "RECHAZAR")
    );
    const now = trustedClock.nowUtc();
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.tesoreriaCierreSolicitud.findFirst({
        where: {
          solicitud_id: requestId,
          gym_id: this.gymId,
          is_deleted: false,
        },
      });
      if (!request) {
        throw new TreasuryLedgerError(
          "La solicitud no pertenece al gimnasio o ya no está disponible.",
          404,
        );
      }
      await assertTreasuryMonthOpen(tx, this.gymId, request.fecha_negocio);
      if (request.decision_operacion_id === operationId) {
        return {
          businessDate: request.fecha_negocio,
          status: request.estado,
          closeId: request.cierre_id,
          stale: false,
        };
      }
      if (request.estado !== "PENDIENTE") {
        throw new TreasuryLedgerError(
          `La solicitud ya fue ${request.estado.toLowerCase()}.`,
          409,
        );
      }
      if (
        request.solicitada_por_user_id === input.userId &&
        !policy.allowSelfApproval
      ) {
        throw new TreasuryLedgerError(
          "La misma persona que registró el arqueo no puede aprobarlo.",
          403,
        );
      }
      const approverName = await this.identityName(tx, input.userId);
      if (decision === "RECHAZAR") {
        const updated = await tx.tesoreriaCierreSolicitud.update({
          where: { solicitud_id: request.solicitud_id },
          data: {
            decision_operacion_id: operationId,
            pendiente_clave: null,
            estado: "RECHAZADA",
            decidida_por_user_id: input.userId,
            decidida_por_nombre_snapshot: approverName,
            decidida_por_rol_snapshot: normalizeTreasuryRole(input.userRole),
            decision_motivo: decisionReason,
            decidida_at: now,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.enqueue(
          tx,
          "tesoreria_cierre_solicitud",
          "UPDATE",
          updated.solicitud_id,
          updated,
          operationId,
        );
        return {
          businessDate: request.fecha_negocio,
          status: "RECHAZADA",
          closeId: null,
          stale: false,
        };
      }

      const current = await tx.tesoreriaMovimiento.findMany({
        where: {
          gym_id: this.gymId,
          fecha_negocio: request.fecha_negocio,
          cuenta_id: request.cuenta_id,
          is_deleted: false,
        },
        orderBy: [{ ocurrido_at: "asc" }, { movimiento_id: "asc" }],
      });
      const expectedIds = this.jsonIds(request.movimiento_ids_json);
      const currentIds = current.map((row) => row.movimiento_id);
      const changed =
        current.some((row) => row.requiere_revision) ||
        expectedIds.length !== currentIds.length ||
        expectedIds.some((id, index) => id !== currentIds[index]);
      if (changed) {
        const updated = await tx.tesoreriaCierreSolicitud.update({
          where: { solicitud_id: request.solicitud_id },
          data: {
            decision_operacion_id: operationId,
            pendiente_clave: null,
            estado: "OBSOLETA",
            decidida_por_user_id: input.userId,
            decidida_por_nombre_snapshot: approverName,
            decidida_por_rol_snapshot: normalizeTreasuryRole(input.userRole),
            decision_motivo:
              "Los movimientos cambiaron después de registrar el arqueo.",
            decidida_at: now,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.enqueue(
          tx,
          "tesoreria_cierre_solicitud",
          "UPDATE",
          updated.solicitud_id,
          updated,
          operationId,
        );
        return {
          businessDate: request.fecha_negocio,
          status: "OBSOLETA",
          closeId: null,
          stale: true,
        };
      }
      const account = await tx.cuenta.findFirst({
        where: {
          cuenta_id: request.cuenta_id,
          gym_id: this.gymId,
          is_deleted: false,
        },
      });
      if (!account || account.moneda_id !== request.moneda_id) {
        throw new TreasuryLedgerError(
          "La cuenta del arqueo ya no está disponible.",
          409,
        );
      }
      if (await tx.tesoreriaCierre.findUnique({
        where: { clave_cierre: this.closeKey(request.fecha_negocio, request.cuenta_id) },
      })) {
        throw new TreasuryLedgerError(
          "La cuenta ya fue cerrada por otra operación.",
          409,
        );
      }
      const amounts = treasuryCloseAmounts({
        opening: this.money(request.saldo_inicial),
        counted: this.money(request.saldo_contado),
        entriesMinor: treasuryMoneyToMinor(this.money(request.total_entradas)),
        exitsMinor: treasuryMoneyToMinor(this.money(request.total_salidas)),
      });
      const close = await this.createClose(tx, {
        operationId,
        businessDate: request.fecha_negocio,
        account,
        movements: current,
        amounts,
        userId: request.solicitada_por_user_id,
        toleranceMinor: treasuryMoneyToMinor(
          this.money(request.tolerancia_aplicada),
        ),
        reason: request.motivo,
        approvalState: "APROBADA",
        requestId: request.solicitud_id,
        approver: {
          userId: input.userId,
          name: approverName,
          role: normalizeTreasuryRole(input.userRole),
          at: now,
        },
        now,
      });
      const updated = await tx.tesoreriaCierreSolicitud.update({
        where: { solicitud_id: request.solicitud_id },
        data: {
          decision_operacion_id: operationId,
          pendiente_clave: null,
          estado: "APROBADA",
          decidida_por_user_id: input.userId,
          decidida_por_nombre_snapshot: approverName,
          decidida_por_rol_snapshot: normalizeTreasuryRole(input.userRole),
          decision_motivo: decisionReason,
          decidida_at: now,
          cierre_id: close.cierre_id,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.enqueue(
        tx,
        "tesoreria_cierre_solicitud",
        "UPDATE",
        updated.solicitud_id,
        updated,
        `${operationId}:request`,
      );
      return {
        businessDate: request.fecha_negocio,
        status: "APROBADA",
        closeId: close.cierre_id,
        stale: false,
      };
    }, { timeout: 30_000 });
    if (result.stale) {
      throw new TreasuryLedgerError(
        "El arqueo cambió por nuevos movimientos. La solicitud quedó obsoleta; registre un arqueo nuevo.",
        409,
      );
    }
    return result;
  }

  private async closeContext(
    tx: Tx,
    businessDate: Date,
    accountId: string,
    openingInput: unknown,
    countedInput: unknown,
  ) {
    const account = await tx.cuenta.findFirst({
      where: { cuenta_id: accountId, gym_id: this.gymId, is_deleted: false },
    });
    if (!account) {
      throw new TreasuryLedgerError(
        "La cuenta no pertenece al gimnasio o ya no está disponible.",
        404,
      );
    }
    if (await tx.tesoreriaCierre.findUnique({
      where: { clave_cierre: this.closeKey(businessDate, accountId) },
    })) {
      throw new TreasuryLedgerError(
        "Esta cuenta ya tiene un cierre para la fecha seleccionada.",
        409,
      );
    }
    const movements = await tx.tesoreriaMovimiento.findMany({
      where: {
        gym_id: this.gymId,
        fecha_negocio: businessDate,
        cuenta_id: accountId,
        is_deleted: false,
      },
      orderBy: [{ ocurrido_at: "asc" }, { movimiento_id: "asc" }],
    });
    const review = movements.filter((row) => row.requiere_revision);
    if (review.length) {
      throw new TreasuryLedgerError(
        `Hay ${review.length} movimiento(s) que requieren revisión antes del cierre.`,
        409,
      );
    }
    const entriesMinor = this.sumDirection(movements, "ENTRADA");
    const exitsMinor = this.sumDirection(movements, "SALIDA");
    const previous = await tx.tesoreriaCierre.findFirst({
      where: {
        gym_id: this.gymId,
        cuenta_id: accountId,
        fecha_negocio: { lt: businessDate },
        is_deleted: false,
      },
      orderBy: [{ fecha_negocio: "desc" }, { cerrado_at: "desc" }],
    });
    const opening = openingInput ?? (previous
      ? await this.adjustedCloseBalance(tx, previous)
      : "0");
    const amounts = this.policyCall(() => treasuryCloseAmounts({
      opening: opening as any,
      counted: countedInput as any,
      entriesMinor,
      exitsMinor,
    }));
    return {
      account,
      movements,
      entriesMinor,
      exitsMinor,
      amounts,
      lastMovementAt: movements.length
        ? movements[movements.length - 1]!.ocurrido_at
        : null,
    };
  }

  private async createClose(tx: Tx, input: {
    operationId: string;
    businessDate: Date;
    account: any;
    movements: any[];
    amounts: ReturnType<typeof treasuryCloseAmounts>;
    userId: string;
    toleranceMinor: bigint;
    reason: string | null;
    approvalState: string;
    requestId?: string;
    approver?: { userId: string; name: string; role: string; at: Date };
    now: Date;
  }) {
    const operatorName = await this.identityName(tx, input.userId);
    const closeId = randomUUID();
    const snapshot = this.snapshot({
      businessDate: input.businessDate,
      account: input.account,
      movements: input.movements,
      amounts: input.amounts,
      toleranceMinor: input.toleranceMinor,
      reason: input.reason,
      approvalState: input.approvalState,
      requestId: input.requestId,
      approver: input.approver,
    });
    const close = await tx.tesoreriaCierre.create({
      data: {
        cierre_id: closeId,
        operacion_id: input.operationId,
        clave_cierre: this.closeKey(input.businessDate, input.account.cuenta_id),
        comprobante_numero: this.receiptNumber(input.businessDate, closeId),
        fecha_negocio: input.businessDate,
        cuenta_id: input.account.cuenta_id,
        moneda_id: input.account.moneda_id,
        saldo_inicial: input.amounts.opening,
        total_entradas: snapshot.entradas,
        total_salidas: snapshot.salidas,
        saldo_esperado: input.amounts.expected,
        saldo_contado: input.amounts.counted,
        diferencia: input.amounts.difference,
        aprobacion_estado: input.approvalState,
        tolerancia_aplicada: treasuryMinorToMoney(input.toleranceMinor),
        solicitud_id: input.requestId ?? null,
        justificacion_diferencia: input.reason,
        aprobado_por_user_id: input.approver?.userId ?? null,
        aprobado_por_nombre_snapshot: input.approver?.name ?? null,
        aprobado_por_rol_snapshot: input.approver?.role ?? null,
        aprobado_at: input.approver?.at ?? null,
        movimientos_cantidad: input.movements.length,
        movimientos_hasta_at: input.movements.length
          ? input.movements[input.movements.length - 1]!.ocurrido_at
          : null,
        cerrado_por_user_id: input.userId,
        cerrado_por_nombre_snapshot: operatorName,
        cerrado_at: input.now,
        snapshot_json: JSON.stringify(snapshot),
        is_deleted: false,
        created_at: input.now,
        gym_id: this.gymId,
        source_device: "WEB_ADMIN",
        version: 1,
        updated_at: input.now,
        deleted_at: null,
      },
    });
    await this.enqueue(
      tx,
      "tesoreria_cierre",
      "INSERT",
      close.cierre_id,
      close,
      input.requestId ? `${input.operationId}:close` : input.operationId,
    );
    return close;
  }

  private snapshot(input: {
    businessDate: Date;
    account: any;
    movements: any[];
    amounts: ReturnType<typeof treasuryCloseAmounts>;
    toleranceMinor: bigint;
    reason: string | null;
    approvalState?: string;
    requestId?: string;
    approver?: { userId: string; name: string; role: string; at: Date };
  }) {
    const entries = this.sumDirection(input.movements, "ENTRADA");
    const exits = this.sumDirection(input.movements, "SALIDA");
    return {
      version: 2,
      fecha_negocio: input.businessDate.toISOString().slice(0, 10),
      cuenta_id: input.account.cuenta_id,
      moneda_id: input.account.moneda_id,
      movimiento_ids: input.movements.map((row) => row.movimiento_id),
      entradas: treasuryMinorToMoney(entries),
      salidas: treasuryMinorToMoney(exits),
      saldo_inicial: input.amounts.opening,
      saldo_esperado: input.amounts.expected,
      saldo_contado: input.amounts.counted,
      diferencia: input.amounts.difference,
      tolerancia_aplicada: treasuryMinorToMoney(input.toleranceMinor),
      justificacion_diferencia: input.reason,
      aprobacion_estado: input.approvalState ?? "PENDIENTE",
      solicitud_id: input.requestId ?? null,
      aprobado_por: input.approver
        ? {
            user_id: input.approver.userId,
            nombre: input.approver.name,
            rol: input.approver.role,
            aprobado_at: input.approver.at.toISOString(),
          }
        : null,
    };
  }

  private async readPolicy(): Promise<TreasuryCloseApprovalPolicy> {
    const row = await prisma.configuracionSistema.findUnique({
      where: { clave_gym_id: { clave: POLICY_KEY, gym_id: this.gymId } },
    });
    if (!row || row.is_deleted) return defaultTreasuryCloseApprovalPolicy;
    try {
      return normalizeTreasuryCloseApprovalPolicy(JSON.parse(row.valor));
    } catch {
      throw new TreasuryLedgerError(
        "La política de aprobación de arqueos está dañada.",
        500,
      );
    }
  }

  private presentPolicy(policy: TreasuryCloseApprovalPolicy) {
    return {
      version: policy.version,
      tolerancia_predeterminada: policy.defaultTolerance,
      tolerancias_por_moneda: policy.currencyTolerances,
      roles_solicitantes: policy.submitterRoles,
      roles_aprobadores: policy.approverRoles,
      permite_autoaprobacion: policy.allowSelfApproval,
      exige_motivo_diferencia: policy.requireReasonForDifference,
    };
  }

  private presentRequest(request: any) {
    return {
      solicitud_id: request.solicitud_id,
      operacion_id: request.operacion_id,
      fecha_negocio: request.fecha_negocio.toISOString().slice(0, 10),
      cuenta_id: request.cuenta_id,
      moneda_id: request.moneda_id,
      saldo_inicial: this.money(request.saldo_inicial),
      total_entradas: this.money(request.total_entradas),
      total_salidas: this.money(request.total_salidas),
      saldo_esperado: this.money(request.saldo_esperado),
      saldo_contado: this.money(request.saldo_contado),
      diferencia: this.money(request.diferencia),
      tolerancia_aplicada: this.money(request.tolerancia_aplicada),
      movimientos_cantidad: request.movimientos_cantidad,
      motivo: request.motivo,
      estado: request.estado,
      solicitada_por_user_id: request.solicitada_por_user_id,
      solicitada_por_nombre_snapshot: request.solicitada_por_nombre_snapshot,
      solicitada_por_rol_snapshot: request.solicitada_por_rol_snapshot,
      solicitada_at: request.solicitada_at,
      decidida_por_nombre_snapshot: request.decidida_por_nombre_snapshot,
      decidida_por_rol_snapshot: request.decidida_por_rol_snapshot,
      decision_motivo: request.decision_motivo,
      decidida_at: request.decidida_at,
      cierre_id: request.cierre_id,
    };
  }

  private assertRepeatedRequest(request: any, date: Date, accountId: string) {
    if (
      request.gym_id !== this.gymId ||
      request.cuenta_id !== accountId ||
      request.fecha_negocio.getTime() !== date.getTime()
    ) {
      throw new TreasuryLedgerError(
        "Ese identificador de operación ya fue usado en otro arqueo.",
        409,
      );
    }
  }

  private async adjustedCloseBalance(tx: Tx, close: any) {
    const reconciliations = await tx.tesoreriaConciliacion.findMany({
      where: {
        gym_id: this.gymId,
        cierre_id: close.cierre_id,
        is_deleted: false,
      },
    });
    const adjustment = reconciliations.reduce(
      (sum, row) => sum + treasuryMoneyToMinor(this.money(row.ajuste_neto)),
      0n,
    );
    return treasuryMinorToMoney(
      treasuryMoneyToMinor(this.money(close.saldo_contado)) + adjustment,
    );
  }

  private sumDirection(rows: any[], direction: "ENTRADA" | "SALIDA") {
    return rows
      .filter((row) => row.direccion === direction)
      .reduce(
        (sum, row) => sum + treasuryMoneyToMinor(this.money(row.monto)),
        0n,
      );
  }

  private jsonIds(value: string): string[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private closeKey(date: Date, accountId: string) {
    return `${this.gymId}|${date.toISOString().slice(0, 10)}|${accountId}`;
  }

  private receiptNumber(date: Date, id: string) {
    return `CIE-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${id
      .slice(0, 8)
      .toUpperCase()}`;
  }

  private policyId() {
    return `cfg-tes-close-${createHash("sha256")
      .update(this.gymId)
      .digest("hex")
      .slice(0, 24)}`;
  }

  private intentSignature(input: {
    businessDate: Date;
    accountId: string;
    opening: string;
    counted: string;
    movementIds: string[];
    reason: string | null;
  }) {
    return createHash("sha256")
      .update(JSON.stringify({
        gym_id: this.gymId,
        fecha: input.businessDate.toISOString().slice(0, 10),
        cuenta_id: input.accountId,
        saldo_inicial: input.opening,
        saldo_contado: input.counted,
        movimientos: input.movementIds,
        motivo: input.reason,
      }))
      .digest("hex");
  }

  private money(value: unknown) {
    if (value && typeof value === "object" && "toString" in value) {
      return (value as { toString(): string }).toString();
    }
    return Number(value ?? 0).toFixed(2);
  }

  private async identityName(tx: Tx, userId: string) {
    const user = await tx.user.findFirst({
      where: {
        user_id: userId,
        gym_id: this.gymId,
        active: true,
        is_deleted: false,
      },
    });
    if (!user) {
      throw new TreasuryLedgerError("La cuenta operadora no es válida.", 403);
    }
    return user.user_nombre;
  }

  private async enqueue(
    tx: Tx,
    entity: string,
    operation: "INSERT" | "UPDATE",
    id: string,
    row: unknown,
    eventId: string = randomUUID(),
  ) {
    await tx.syncLog.create({
      data: {
        event_id: eventId,
        entidad: entity,
        operacion: operation,
        entidad_id: id,
        gym_id: this.gymId,
        device_id: "WEB_ADMIN",
        payload_json: JSON.stringify(serialize(row)),
      },
    });
  }

  private policyCall<T>(callback: () => T): T {
    try {
      return callback();
    } catch (error) {
      if (error instanceof TreasuryLedgerPolicyError) {
        throw new TreasuryLedgerError(error.message);
      }
      throw error;
    }
  }
}
