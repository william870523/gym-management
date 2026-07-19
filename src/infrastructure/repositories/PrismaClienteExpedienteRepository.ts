import type { ClienteExpedienteRepository } from "../../domain/repositories/ClienteExpedienteRepository";
import { prisma } from "../db/prismaClient";

const money = (value: unknown) => Number(value ?? 0).toFixed(2);
const detailMoney = (value: unknown) => Number(value ?? 0).toFixed(4);

export class PrismaClienteExpedienteRepository implements ClienteExpedienteRepository {
  async findByClient(ci: string, gymId: string) {
    const client = await prisma.cliente.findFirst({
      where: { ci, gym_id: gymId, is_deleted: false },
      select: { ci: true, nombres: true, apellidos: true },
    });
    if (!client) return null;

    const memberships = await prisma.membresiaCliente.findMany({
      where: { ci, gym_id: gymId, is_deleted: false },
      orderBy: [{ fecha_inicio: "desc" }, { created_at: "desc" }],
    });
    const membershipIds = memberships.map((item) => item.membresia_id);
    const [assignments, pauses, requests, applications, payments] =
      await Promise.all([
        prisma.membresiaEntrenadorAsignacion.findMany({
          where: {
            membresia_id: { in: membershipIds },
            gym_id: gymId,
          },
          orderBy: { fecha_inicio: "desc" },
        }),
        prisma.membresiaPausa.findMany({
          where: {
            membresia_id: { in: membershipIds },
            gym_id: gymId,
            is_deleted: false,
          },
          orderBy: { fecha_pausa: "desc" },
        }),
        prisma.membresiaSolicitud.findMany({
          where: {
            membresia_id: { in: membershipIds },
            gym_id: gymId,
            is_deleted: false,
          },
          orderBy: { solicitada_at: "desc" },
        }),
        prisma.pagoMembresiaAplicacion.findMany({
          where: {
            membresia_id: { in: membershipIds },
            gym_id: gymId,
            is_deleted: false,
          },
        }),
        prisma.pagoCliente.findMany({
          // El expediente es histórico: conserva también los cobros anulados.
          where: { ci, gym_id: gymId },
          orderBy: { fecha: "desc" },
        }),
      ]);

    const paymentIds = payments.map((item) => item.pago_cliente_id);
    const trainerIds = [
      ...new Set(assignments.map((item) => item.id_entrenador)),
    ];
    const [details, trainers] = await Promise.all([
      prisma.detallePago.findMany({
        where: {
          pago_cliente_id: { in: paymentIds },
          gym_id: gymId,
          is_deleted: false,
        },
      }),
      prisma.entrenador.findMany({
        where: { id_entrenador: { in: trainerIds }, gym_id: gymId },
        select: {
          id_entrenador: true,
          nombres_entrenador: true,
          apellidos_entrenador: true,
        },
      }),
    ]);
    const currencyIds = [
      ...new Set([
        ...memberships.map((item) => item.moneda_id),
        ...payments.map((item) => item.moneda_id),
        ...details.map((item) => item.moneda_id),
      ]),
    ];
    const paymentTypeIds = [
      ...new Set(details.map((item) => item.tipo_pago_id)),
    ];
    const accountIds = [
      ...new Set(
        details.flatMap((item) => (item.cuenta_id ? [item.cuenta_id] : [])),
      ),
    ];
    const rateIds = [
      ...new Set(
        details.flatMap((item) =>
          item.tipo_cambio_id ? [item.tipo_cambio_id] : [],
        ),
      ),
    ];
    const [currencies, paymentTypes, accounts, rates] = await Promise.all([
      prisma.moneda.findMany({
        where: { moneda_id: { in: currencyIds }, is_deleted: false },
        select: {
          moneda_id: true,
          moneda_nombre: true,
          codigo: true,
          simbolo: true,
        },
      }),
      prisma.tipoPago.findMany({
        where: { tipo_pago_id: { in: paymentTypeIds } },
        select: { tipo_pago_id: true, nombre_tipo_pago: true },
      }),
      prisma.cuenta.findMany({
        where: {
          cuenta_id: { in: accountIds },
          OR: [{ gym_id: gymId }, { gym_id: null }],
        },
        select: { cuenta_id: true, nombre_cuenta: true },
      }),
      prisma.tipoCambio.findMany({
        where: { tipo_cambio_id: { in: rateIds } },
        select: {
          tipo_cambio_id: true,
          moneda_id_base: true,
          moneda_id_target: true,
          exchange_rate: true,
        },
      }),
    ]);

    const trainersById = new Map(
      trainers.map((trainer) => [
        trainer.id_entrenador,
        `${trainer.nombres_entrenador} ${trainer.apellidos_entrenador}`.trim(),
      ]),
    );
    const currenciesById = new Map(
      currencies.map((currency) => [currency.moneda_id, currency]),
    );
    const paymentTypesById = new Map(
      paymentTypes.map((type) => [type.tipo_pago_id, type.nombre_tipo_pago]),
    );
    const accountsById = new Map(
      accounts.map((account) => [account.cuenta_id, account.nombre_cuenta]),
    );
    const ratesById = new Map(rates.map((rate) => [rate.tipo_cambio_id, rate]));
    const detailsByPayment = new Map<string, typeof details>();
    for (const detail of details) {
      const group = detailsByPayment.get(detail.pago_cliente_id) ?? [];
      group.push(detail);
      detailsByPayment.set(detail.pago_cliente_id, group);
    }
    const paymentsById = new Map(
      payments.map((payment) => [payment.pago_cliente_id, payment]),
    );
    const linkedPaymentIds = new Set(
      applications.map((application) => application.pago_cliente_id),
    );

    const paymentView = (payment: (typeof payments)[number]) => {
      const currency = currenciesById.get(payment.moneda_id);
      return {
        pago_cliente_id: payment.pago_cliente_id,
        fecha: payment.fecha,
        monto_total: money(payment.monto_total),
        moneda_id: payment.moneda_id,
        moneda_codigo: currency?.codigo ?? null,
        moneda_simbolo: currency?.simbolo ?? null,
        id_planes_pago: payment.id_planes_pago,
        id_entrenador: payment.id_entrenador,
        is_deleted: payment.is_deleted,
        deleted_at: payment.deleted_at,
        detalles: (detailsByPayment.get(payment.pago_cliente_id) ?? []).map(
          (detail) => {
            const detailCurrency = currenciesById.get(detail.moneda_id);
            const rate = detail.tipo_cambio_id
              ? ratesById.get(detail.tipo_cambio_id)
              : null;
            return {
              detalle_pago_id: detail.detalle_pago_id,
              tipo_pago_id: detail.tipo_pago_id,
              tipo_pago_nombre:
                paymentTypesById.get(detail.tipo_pago_id) ?? null,
              cuenta_id: detail.cuenta_id,
              cuenta_nombre: detail.cuenta_id
                ? (accountsById.get(detail.cuenta_id) ?? null)
                : null,
              moneda_id: detail.moneda_id,
              moneda_codigo: detailCurrency?.codigo ?? null,
              moneda_simbolo: detailCurrency?.simbolo ?? null,
              cantidad: detailMoney(detail.cantidad),
              tipo_cambio_id: detail.tipo_cambio_id,
              tipo_cambio_tasa: rate?.exchange_rate ?? null,
              tipo_cambio_moneda_base_id: rate?.moneda_id_base ?? null,
              tipo_cambio_moneda_target_id: rate?.moneda_id_target ?? null,
            };
          },
        ),
      };
    };
    const assignmentsByMembership = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const group = assignmentsByMembership.get(assignment.membresia_id) ?? [];
      group.push(assignment);
      assignmentsByMembership.set(assignment.membresia_id, group);
    }
    const applicationsByMembership = new Map<string, typeof applications>();
    for (const application of applications) {
      const group =
        applicationsByMembership.get(application.membresia_id) ?? [];
      group.push(application);
      applicationsByMembership.set(application.membresia_id, group);
    }
    const pausesByMembership = new Map<string, typeof pauses>();
    for (const pause of pauses) {
      const group = pausesByMembership.get(pause.membresia_id) ?? [];
      group.push(pause);
      pausesByMembership.set(pause.membresia_id, group);
    }
    const requestsByMembership = new Map<string, typeof requests>();
    for (const request of requests) {
      const group = requestsByMembership.get(request.membresia_id) ?? [];
      group.push(request);
      requestsByMembership.set(request.membresia_id, group);
    }
    const totals = new Map<string, { amount: number; count: number }>();
    for (const payment of payments) {
      if (payment.is_deleted) continue;
      const current = totals.get(payment.moneda_id) ?? { amount: 0, count: 0 };
      current.amount += Number(payment.monto_total);
      current.count += 1;
      totals.set(payment.moneda_id, current);
    }

    return {
      cliente: client,
      membresias: memberships.map((membership) => {
        const currency = currenciesById.get(membership.moneda_id);
        return {
          membresia_id: membership.membresia_id,
          id_planes_pago: membership.id_planes_pago,
          plan_nombre: membership.plan_nombre_snapshot,
          precio: money(membership.precio_snapshot),
          moneda_id: membership.moneda_id,
          moneda_codigo: currency?.codigo ?? null,
          moneda_simbolo: currency?.simbolo ?? null,
          duracion_dias: membership.duracion_dias_snapshot,
          fecha_inicio: membership.fecha_inicio,
          fecha_fin: membership.fecha_fin,
          estado: membership.estado,
          origen: membership.origen,
          importe_pagado: money(membership.importe_pagado),
          activada_at: membership.activada_at,
          reconstruida: membership.reconstruida,
          confianza_reconstruccion: membership.confianza_reconstruccion,
          pausas: (pausesByMembership.get(membership.membresia_id) ?? []).map(
            (pause) => ({
              pausa_id: pause.pausa_id,
              fecha_pausa: pause.fecha_pausa,
              fecha_reanudacion: pause.fecha_reanudacion,
              fecha_fin_anterior: pause.fecha_fin_anterior,
              fecha_fin_recalculada: pause.fecha_fin_recalculada,
              dias_restantes: pause.dias_restantes_snapshot,
              motivo: pause.motivo,
              estado: pause.estado,
              pausada_at: pause.pausada_at,
              reanudada_at: pause.reanudada_at,
            }),
          ),
          solicitudes: (
            requestsByMembership.get(membership.membresia_id) ?? []
          ).map((request) => ({
            solicitud_id: request.solicitud_id,
            membresia_id: request.membresia_id,
            ci: request.ci,
            tipo: request.tipo,
            motivo: request.motivo,
            estado: request.estado,
            fecha_efectiva_solicitada: request.fecha_efectiva_solicitada,
            fecha_efectiva_aplicada: request.fecha_efectiva_aplicada,
            dias_restantes_estimados: request.dias_restantes_estimados,
            dias_restantes_aplicados: request.dias_restantes_aplicados,
            fecha_fin_estimada: request.fecha_fin_estimada,
            fecha_fin_resultante: request.fecha_fin_resultante,
            solicitada_por_user_id: request.solicitada_por_user_id,
            solicitada_por_nombre: request.solicitada_por_nombre_snapshot,
            solicitada_at: request.solicitada_at,
            decidida_por_user_id: request.decidida_por_user_id,
            decidida_por_nombre: request.decidida_por_nombre_snapshot,
            decision_motivo: request.decision_motivo,
            decidida_at: request.decidida_at,
          })),
          entrenadores: (
            assignmentsByMembership.get(membership.membresia_id) ?? []
          ).map((assignment) => ({
            asignacion_id: assignment.asignacion_id,
            id_entrenador: assignment.id_entrenador,
            entrenador_nombre:
              trainersById.get(assignment.id_entrenador) ?? null,
            fecha_inicio: assignment.fecha_inicio,
            fecha_fin: assignment.fecha_fin,
            estado: assignment.estado,
            motivo_cierre: assignment.motivo_cierre,
          })),
          pagos: (
            applicationsByMembership.get(membership.membresia_id) ?? []
          ).flatMap((application) => {
            const payment = paymentsById.get(application.pago_cliente_id);
            return payment
              ? [
                  {
                    ...paymentView(payment),
                    aplicacion_id: application.aplicacion_id,
                    monto_aplicado: money(application.monto_aplicado),
                    aplicacion_anulada: application.is_deleted,
                  },
                ]
              : [];
          }),
        };
      }),
      pagos_sin_membresia: payments
        .filter((payment) => !linkedPaymentIds.has(payment.pago_cliente_id))
        .map(paymentView),
      totales_por_moneda: [...totals.entries()].map(([currencyId, total]) => {
        const currency = currenciesById.get(currencyId);
        return {
          moneda_id: currencyId,
          moneda_nombre: currency?.moneda_nombre ?? null,
          codigo: currency?.codigo ?? null,
          simbolo: currency?.simbolo ?? null,
          monto_total: total.amount.toFixed(2),
          cantidad_pagos: total.count,
        };
      }),
    };
  }
}
