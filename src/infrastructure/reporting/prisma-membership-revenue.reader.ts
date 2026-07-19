import { CompensationProfileService } from "../../application/accounting/compensation-profile.service";
import type { MembershipRevenueReader } from "../../application/reporting/membership-revenue.reader";
import type { MembershipRevenueSnapshot } from "../../domain/membership-revenue-policy";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";

export class PrismaMembershipRevenueReader implements MembershipRevenueReader {
  private readonly profiles = new CompensationProfileService();

  async currentBusinessDate(gymId: string) {
    return prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())
    );
  }

  async readMemberships(gymId: string): Promise<MembershipRevenueSnapshot[]> {
    const memberships = await prisma.membresiaCliente.findMany({
      where: { gym_id: gymId, is_deleted: false },
      orderBy: [{ fecha_inicio: "asc" }, { membresia_id: "asc" }],
    });
    if (memberships.length === 0) return [];
    const membershipIds = memberships.map((row) => row.membresia_id);
    const clientIds = [...new Set(memberships.map((row) => row.ci))];
    const currencyIds = [...new Set(memberships.map((row) => row.moneda_id))];
    const [clients, currencies, cashApplications, creditApplications, pauses, adjustments] =
      await Promise.all([
        prisma.cliente.findMany({
          where: { ci: { in: clientIds }, gym_id: gymId },
          select: { ci: true, nombres: true, apellidos: true },
        }),
        prisma.moneda.findMany({
          where: { moneda_id: { in: currencyIds } },
          select: { moneda_id: true, codigo: true },
        }),
        prisma.pagoMembresiaAplicacion.findMany({
          where: { gym_id: gymId, membresia_id: { in: membershipIds } },
        }),
        prisma.creditoMembresiaAplicacion.findMany({
          where: { gym_id: gymId, membresia_id: { in: membershipIds } },
        }),
        prisma.membresiaPausa.findMany({
          where: {
            gym_id: gymId,
            membresia_id: { in: membershipIds },
          },
        }),
        prisma.membresiaAjusteFinanciero.findMany({
          where: { gym_id: gymId, membresia_origen_id: { in: membershipIds } },
        }),
      ]);
    const paymentIds = [...new Set(
      cashApplications.map((row) => row.pago_cliente_id),
    )];
    const payments = paymentIds.length === 0
      ? []
      : await prisma.pagoCliente.findMany({
          where: { pago_cliente_id: { in: paymentIds }, gym_id: gymId },
        });
    const clientById = new Map(clients.map((row) => [row.ci, row]));
    const currencyById = new Map(
      currencies.map((row) => [row.moneda_id, row.codigo]),
    );
    const paymentById = new Map(
      payments.map((row) => [row.pago_cliente_id, row]),
    );
    const cashByMembership = groupBy(
      cashApplications,
      (row) => row.membresia_id,
    );
    const creditByMembership = groupBy(
      creditApplications,
      (row) => row.membresia_id,
    );
    const pausesByMembership = groupBy(pauses, (row) => row.membresia_id);
    const adjustmentsByMembership = groupBy(
      adjustments,
      (row) => row.membresia_origen_id,
    );

    return memberships.map((membership) => {
      const client = clientById.get(membership.ci);
      const membershipPauses =
        pausesByMembership.get(membership.membresia_id) ?? [];
      const membershipAdjustments =
        adjustmentsByMembership.get(membership.membresia_id) ?? [];
      const calendarDates = [
        membership.fecha_inicio,
        membership.fecha_fin,
        ...membershipPauses.flatMap((row) =>
          row.fecha_reanudacion
            ? [row.fecha_pausa, row.fecha_reanudacion]
            : [row.fecha_pausa]
        ),
        ...membershipAdjustments.map((row) => row.fecha_efectiva),
      ];
      return {
        membershipId: membership.membresia_id,
        clientId: membership.ci,
        clientName: [client?.nombres, client?.apellidos]
          .filter(Boolean)
          .join(" ") || membership.ci,
        planId: membership.id_planes_pago,
        planName: membership.plan_nombre_snapshot,
        currencyId: membership.moneda_id,
        currencyCode: currencyById.get(membership.moneda_id) ?? membership.moneda_id,
        price: membership.precio_snapshot.toString(),
        durationDays: membership.duracion_dias_snapshot,
        start: normalizeRevenueCalendarDate(membership.fecha_inicio),
        endExclusive: normalizeRevenueCalendarDate(membership.fecha_fin),
        state: membership.estado,
        origin: membership.origen,
        reconstructed: membership.reconstruida,
        normalizedLegacyCalendarDates: calendarDates.some(
          (value) => !isCanonicalRevenueCalendarDate(value),
        ),
        createdAt: membership.created_at,
        funding: [
          ...(cashByMembership.get(membership.membresia_id) ?? [])
            .flatMap((row) => {
              const payment = paymentById.get(row.pago_cliente_id);
              if (!payment) return [];
              return [{
                kind: "EFECTIVO" as const,
                amount: row.monto_aplicado.toString(),
                occurredAt: payment.fecha,
                createdAt: row.created_at ?? payment.fecha,
                deletedAt: earliest(row.deleted_at, payment.deleted_at),
              }];
            }),
          ...(creditByMembership.get(membership.membresia_id) ?? [])
            .map((row) => ({
              kind: "CREDITO" as const,
              amount: row.monto_aplicado.toString(),
              occurredAt: row.aplicada_at,
              createdAt: row.created_at,
              deletedAt: row.deleted_at,
            })),
        ],
        pauses: membershipPauses
          .map((row) => ({
            start: normalizeRevenueCalendarDate(row.fecha_pausa),
            end: row.fecha_reanudacion
              ? normalizeRevenueCalendarDate(row.fecha_reanudacion)
              : null,
            createdAt: row.created_at ?? row.pausada_at,
            deletedAt: row.deleted_at,
          })),
        adjustments: membershipAdjustments
          .map((row) => ({
            type: row.tipo,
            effectiveDate: normalizeRevenueCalendarDate(row.fecha_efectiva),
            unusedAmount: row.valor_no_consumido.toString(),
            createdAt: row.created_at,
            deletedAt: row.deleted_at,
          })),
      };
    });
  }
}

function earliest(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() <= right.getTime() ? left : right;
}

export function isCanonicalRevenueCalendarDate(value: Date) {
  return value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;
}

export function normalizeRevenueCalendarDate(value: Date) {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ),
  );
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const id = key(value);
    const rows = grouped.get(id) ?? [];
    rows.push(value);
    grouped.set(id, rows);
  }
  return grouped;
}
