import { CompensationProfileService } from "../../application/accounting/compensation-profile.service";
import type {
  OperationalResultsPeriod,
  OperationalResultsReadData,
  OperationalResultsReader,
} from "../../application/reporting/operational-results.reader";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";

export class PrismaOperationalResultsReader implements OperationalResultsReader {
  private readonly profiles = new CompensationProfileService();

  async currentBusinessMonth(gymId: string): Promise<string> {
    const businessDate = await prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())
    );
    return businessDate.toISOString().slice(0, 7);
  }

  async readMonthlyCloses(gymId: string, year: string) {
    const closes = await prisma.tesoreriaCierreMensual.findMany({
      where: {
        gym_id: gymId,
        mes: { startsWith: `${year}-` },
        is_deleted: false,
      },
      orderBy: [{ mes: "asc" }, { cerrado_at: "desc" }],
    });
    return closes.map((row) => ({
      monthlyCloseId: row.cierre_mensual_id,
      month: row.mes,
      state: row.estado,
      sha256: row.resumen_sha256,
      snapshotJson: row.resumen_snapshot_json,
      closedAt: row.cerrado_at,
      reopenedAt: row.reabierto_at,
    }));
  }

  async read(
    gymId: string,
    period: OperationalResultsPeriod,
  ): Promise<OperationalResultsReadData> {
    const businessDate = await prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())
    );
    const [
      movements,
      accounts,
      currencies,
      dailyCloses,
      monthlyClose,
      commissionInstallments,
      fixedObligations,
      refundRequests,
    ] =
      await Promise.all([
        prisma.tesoreriaMovimiento.findMany({
          where: {
            gym_id: gymId,
            fecha_negocio: { gte: period.start, lt: period.endExclusive },
            is_deleted: false,
          },
          orderBy: [{ fecha_negocio: "asc" }, { ocurrido_at: "asc" }],
        }),
        prisma.cuenta.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: { nombre_cuenta: "asc" },
        }),
        prisma.moneda.findMany({
          where: { is_deleted: false },
          orderBy: { codigo: "asc" },
        }),
        prisma.tesoreriaCierre.findMany({
          where: {
            gym_id: gymId,
            fecha_negocio: { gte: period.start, lt: period.endExclusive },
            is_deleted: false,
          },
          orderBy: [{ fecha_negocio: "asc" }, { cuenta_id: "asc" }],
        }),
        prisma.tesoreriaCierreMensual.findFirst({
          where: { gym_id: gymId, mes: period.month, is_deleted: false },
          orderBy: { cerrado_at: "desc" },
        }),
        prisma.entrenadorComisionCuota.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: [{ periodo_inicio: "asc" }, { cuota_id: "asc" }],
        }),
        prisma.entrenadorObligacionFija.findMany({
          where: { gym_id: gymId, is_deleted: false },
          orderBy: [{ periodo_inicio: "asc" }, { obligacion_id: "asc" }],
        }),
        prisma.membresiaAjusteFinanciero.findMany({
          where: {
            gym_id: gymId,
            tipo: "REEMBOLSO_PENDIENTE",
            is_deleted: false,
          },
          orderBy: [{ registrada_at: "asc" }, { ajuste_financiero_id: "asc" }],
        }),
      ]);

    const trainerIds = [...new Set([
      ...commissionInstallments.map((row) => row.id_entrenador),
      ...fixedObligations.map((row) => row.id_entrenador),
    ])];
    const commissionIds = commissionInstallments.map((row) => row.cuota_id);
    const fixedIds = fixedObligations.map((row) => row.obligacion_id);
    const accrualIds = [...new Set(commissionInstallments.map((row) => row.devengo_id))];
    const membershipIds = [...new Set(
      refundRequests.map((row) => row.membresia_origen_id),
    )];
    const adjustmentIds = refundRequests.map((row) => row.ajuste_financiero_id);
    const [
      trainers,
      accruals,
      commissionApplications,
      fixedApplications,
      memberships,
      refundDecisions,
    ] = await Promise.all([
      trainerIds.length
        ? prisma.entrenador.findMany({
            where: { gym_id: gymId, id_entrenador: { in: trainerIds } },
          })
        : Promise.resolve([]),
      accrualIds.length
        ? prisma.entrenadorComisionDevengo.findMany({
            where: { gym_id: gymId, devengo_id: { in: accrualIds } },
          })
        : Promise.resolve([]),
      commissionIds.length
        ? prisma.entrenadorLiquidacionAplicacion.findMany({
            where: {
              gym_id: gymId,
              cuota_id: { in: commissionIds },
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
      fixedIds.length
        ? prisma.entrenadorLiquidacionObligacionAplicacion.findMany({
            where: {
              gym_id: gymId,
              obligacion_id: { in: fixedIds },
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
      membershipIds.length
        ? prisma.membresiaCliente.findMany({
            where: { gym_id: gymId, membresia_id: { in: membershipIds } },
          })
        : Promise.resolve([]),
      adjustmentIds.length
        ? prisma.clienteReembolsoTesoreria.findMany({
            where: {
              gym_id: gymId,
              ajuste_financiero_id: { in: adjustmentIds },
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
    ]);
    const clientIds = [...new Set(memberships.map((row) => row.ci))];
    const refundIds = refundDecisions.map((row) => row.reembolso_id);
    const [clients, refundReversals] = await Promise.all([
      clientIds.length
        ? prisma.cliente.findMany({
            where: { gym_id: gymId, ci: { in: clientIds } },
          })
        : Promise.resolve([]),
      refundIds.length
        ? prisma.clienteReembolsoReversion.findMany({
            where: {
              gym_id: gymId,
              reembolso_id: { in: refundIds },
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
    ]);

    const trainerName = new Map(trainers.map((row) => [
      row.id_entrenador,
      `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
    ]));
    const earningMethod = new Map(accruals.map((row) => [
      row.devengo_id,
      row.metodo_devengo ?? "PERIODOS_IGUALES",
    ]));
    const commissionApplicationsById = this.groupApplications(
      commissionApplications,
      (row) => row.cuota_id,
    );
    const fixedApplicationsById = this.groupApplications(
      fixedApplications,
      (row) => row.obligacion_id,
    );
    const membershipById = new Map(
      memberships.map((row) => [row.membresia_id, row]),
    );
    const clientById = new Map(clients.map((row) => [row.ci, row]));
    const reversalsByRefundId = new Map(
      refundReversals.map((row) => [row.reembolso_id, row]),
    );
    const refundEventsByAdjustment = new Map<string, Array<{
      type: "RESUELTO" | "REABIERTO";
      occurredAt: Date;
    }>>();
    for (const decision of refundDecisions) {
      const events = refundEventsByAdjustment.get(decision.ajuste_financiero_id) ?? [];
      events.push({ type: "RESUELTO", occurredAt: decision.registrada_at });
      const reversal = reversalsByRefundId.get(decision.reembolso_id);
      if (reversal) {
        events.push({ type: "REABIERTO", occurredAt: reversal.registrada_at });
      }
      refundEventsByAdjustment.set(decision.ajuste_financiero_id, events);
    }

    return {
      businessDate,
      movements: movements.map((row) => ({
        movementId: row.movimiento_id,
        direction: this.direction(row.direccion),
        concept: row.concepto,
        accountId: row.cuenta_id,
        currencyId: row.moneda_id,
        amount: row.monto.toString(),
        businessDate: row.fecha_negocio,
        requiresReview: row.requiere_revision,
      })),
      accounts: accounts.map((row) => ({
        accountId: row.cuenta_id,
        name: row.nombre_cuenta,
        currencyId: row.moneda_id,
      })),
      currencies: currencies.map((row) => ({
        currencyId: row.moneda_id,
        code: row.codigo,
      })),
      dailyCloses: dailyCloses.map((row) => ({
        accountId: row.cuenta_id,
        currencyId: row.moneda_id,
        businessDate: row.fecha_negocio,
      })),
      monthlyClose: monthlyClose
        ? {
            monthlyCloseId: monthlyClose.cierre_mensual_id,
            month: monthlyClose.mes,
            state: monthlyClose.estado,
            sha256: monthlyClose.resumen_sha256,
            snapshotJson: monthlyClose.resumen_snapshot_json,
            closedAt: monthlyClose.cerrado_at,
            reopenedAt: monthlyClose.reabierto_at,
          }
        : null,
      trainerObligations: [
        ...commissionInstallments.map((row) => ({
          referenceId: row.cuota_id,
          source: "COMISION" as const,
          trainerId: row.id_entrenador,
          trainerName: trainerName.get(row.id_entrenador) ?? row.id_entrenador,
          currencyId: row.moneda_id,
          amount: row.monto.toString(),
          earningMethod: earningMethod.get(row.devengo_id) ?? "PERIODOS_IGUALES",
          periodStart: row.periodo_inicio,
          periodEnd: row.periodo_fin,
          scheduledDate: row.fecha_programada,
          state: row.estado,
          createdAt: row.created_at ?? row.updated_at,
          updatedAt: row.updated_at,
          applications: commissionApplicationsById.get(row.cuota_id) ?? [],
        })),
        ...fixedObligations.map((row) => ({
          referenceId: row.obligacion_id,
          source: "FIJO" as const,
          trainerId: row.id_entrenador,
          trainerName: trainerName.get(row.id_entrenador) ?? row.id_entrenador,
          currencyId: row.moneda_id,
          amount: row.monto.toString(),
          earningMethod: row.metodo_prorrateo,
          periodStart: row.periodo_inicio,
          periodEnd: row.periodo_fin,
          scheduledDate: row.fecha_programada,
          state: row.estado,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          applications: fixedApplicationsById.get(row.obligacion_id) ?? [],
        })),
      ],
      refundRequests: refundRequests.map((row) => {
        const membership = membershipById.get(row.membresia_origen_id);
        const client = membership ? clientById.get(membership.ci) : null;
        const clientId = membership?.ci ?? row.membresia_origen_id;
        return {
          adjustmentId: row.ajuste_financiero_id,
          clientId,
          clientName: client
            ? `${client.nombres} ${client.apellidos}`.trim()
            : clientId,
          currencyId: row.moneda_id,
          amount: row.importe_reembolso.toString(),
          requestedAt: row.registrada_at,
          events: refundEventsByAdjustment.get(row.ajuste_financiero_id) ?? [],
        };
      }),
    };
  }

  private groupApplications<T extends {
    monto_aplicado: unknown;
    estado: string;
    created_at: Date;
    updated_at: Date;
  }>(rows: T[], keyOf: (row: T) => string) {
    const result = new Map<string, Array<{
      amount: string;
      state: "APLICADA" | "REVERSADA";
      createdAt: Date;
      updatedAt: Date;
    }>>();
    for (const row of rows) {
      if (row.estado !== "APLICADA" && row.estado !== "REVERSADA") {
        throw new Error(`Estado de aplicación desconocido: ${row.estado}.`);
      }
      const key = keyOf(row);
      const group = result.get(key) ?? [];
      group.push({
        amount: String(row.monto_aplicado),
        state: row.estado,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      result.set(key, group);
    }
    return result;
  }


  private direction(value: string): "ENTRADA" | "SALIDA" {
    if (value !== "ENTRADA" && value !== "SALIDA") {
      throw new Error(`Movimiento de Tesorería con dirección inválida: ${value}.`);
    }
    return value;
  }
}
