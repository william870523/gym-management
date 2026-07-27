import type { PagoCliente } from "../../domain/entities/PagoCliente";
import type {
    InstallmentPaymentIntent,
    PagoClienteRepository,
} from "../../domain/repositories/PagoClienteRepository";
import type { DetallePago } from "../../domain/entities/DetallePago";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import { trustedClock } from "../../config/trusted-clock";
import type { PlanesPago } from "../../domain/entities/PlanesPago";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { datePartsInZone } from "../../config/tz";
import { collectorFromRow } from "../../application/payment/payment-actor";
import { env } from "../../config/env";
import {
    isFullPayment,
    membershipCashRequired,
    resolveServicePeriod,
} from "../../domain/membership-policy";
import { serialize } from "../../shared/utils/serialize";
import { buildCommissionSchedule } from "../../domain/compensation-profile-policy";
import { CompensationProfileService } from "../../application/accounting/compensation-profile.service";
import { TreasuryLedgerService } from "../../application/accounting/treasury-ledger.service";
import { PlanInstallmentService } from "../../application/membership/plan-installment.service";
import {
    buildRecargoMoraCondonacion,
    calcularDiasAtraso,
    normalizeRecargoMoraConfig,
    quoteRecargoMora,
} from "../../domain/recargo-mora-policy";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";
import { assertGymScopedReference } from "./gym-scoped-reference";
import { PaymentRuleError } from "../../domain/payment-rule-error";

export class PrismaPagoClienteRepository implements PagoClienteRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaPagoClienteRepository {
    return new PrismaPagoClienteRepository(tx);
  }

  // Unidad 01: usa una transacción propia cuando `client` es el prisma raíz;
  // si ya es el cliente de una transacción (upload), la reutiliza en vez de
  // anidar otra —Prisma no soporta transacciones anidadas y un TransactionClient
  // no expone `$transaction`.
  private runInClient<T>(work: (c: any) => Promise<T>): Promise<T> {
    return typeof this.client.$transaction === "function"
      ? this.client.$transaction(work)
      : work(this.client);
  }

    private readonly treasuryLedger = new TreasuryLedgerService();
    private readonly installments = new PlanInstallmentService();
    async upsertPagoCliente(data: PagoCliente): Promise<void> {
        const now = trustedClock.nowUtc();
        if (!data.gym_id) throw new Error("El evento de pago no tiene gimnasio autenticado.");
        await this.runInClient(async (tx) => {
            await Promise.all([
                assertGymScopedReference({
                    delegate: tx.cliente,
                    entity: "cliente",
                    pk: "ci",
                    id: data.ci,
                    gymId: data.gym_id!,
                }),
                assertGymScopedReference({
                    delegate: tx.planesPago,
                    entity: "plan",
                    pk: "id_planes_pago",
                    id: data.id_planes_pago,
                    gymId: data.gym_id!,
                }),
                data.id_entrenador
                    ? assertGymScopedReference({
                        delegate: tx.entrenador,
                        entity: "entrenador",
                        pk: "id_entrenador",
                        id: data.id_entrenador,
                        gymId: data.gym_id!,
                    })
                    : Promise.resolve(),
            ]);
            await upsertGymScopedSyncRecord({
                delegate: tx.pagoCliente,
                entity: "pago_cliente",
                pk: "pago_cliente_id",
                id: data.pago_cliente_id,
                gymId: data.gym_id,
                create: {
                    pago_cliente_id: data.pago_cliente_id,
                    ci: data.ci,
                    fecha: data.fecha,
                    monto_total: data.monto_total,
                recargo_mora_condonado_importe: data.recargo_mora_condonado_importe ?? null,
                recargo_mora_condonado_motivo: data.recargo_mora_condonado_motivo ?? null,
                recargo_mora_condonado_por: data.recargo_mora_condonado_por ?? null,
                    cobrado_por_user_id: data.cobrado_por_user_id ?? null,
                    cobrado_por_nombre_snapshot: data.cobrado_por_nombre_snapshot ?? null,
                    cobrado_por_rol_snapshot: data.cobrado_por_rol_snapshot ?? null,
                    cobrado_por_origen: data.cobrado_por_origen ?? null,
                    id_entrenador: data.id_entrenador ?? null,
                    id_planes_pago: data.id_planes_pago,
                    moneda_id: data.moneda_id,
                    gym_id: data.gym_id,
                    source_device: data.source_device ?? null,
                    version: data.version,
                    created_at: data.created_at ?? now,
                    updated_at: now,
                    deleted_at: null,
                    is_deleted: false,
                },
                update: {
                    ci: data.ci,
                    fecha: data.fecha,
                    monto_total: data.monto_total,
                recargo_mora_condonado_importe: data.recargo_mora_condonado_importe ?? null,
                recargo_mora_condonado_motivo: data.recargo_mora_condonado_motivo ?? null,
                recargo_mora_condonado_por: data.recargo_mora_condonado_por ?? null,
                    cobrado_por_user_id: data.cobrado_por_user_id ?? null,
                    cobrado_por_nombre_snapshot: data.cobrado_por_nombre_snapshot ?? null,
                    cobrado_por_rol_snapshot: data.cobrado_por_rol_snapshot ?? null,
                    cobrado_por_origen: data.cobrado_por_origen ?? null,
                    id_entrenador: data.id_entrenador ?? null,
                    id_planes_pago: data.id_planes_pago,
                    moneda_id: data.moneda_id,
                    gym_id: data.gym_id,
                    source_device: data.source_device ?? null,
                    version: data.version,
                    updated_at: now,
                    deleted_at: null,
                    is_deleted: false,
                },
            });
        });
    }

    async findAll(gymId: string): Promise<PagoCliente[]> {
        const payments = await this.client.pagoCliente.findMany({
            where: { gym_id: gymId, is_deleted: false },
            orderBy: { fecha: "desc" },
            include: {
                cliente: {
                    select: {
                        nombres: true,
                        apellidos: true,
                    },
                },
                detalles: {
                    where: { gym_id: gymId, is_deleted: false },
                },
            },
        });
        return payments.map((payment: any) => ({
            ...payment,
            clientName: `${payment.cliente.nombres ?? ""} ${payment.cliente.apellidos ?? ""}`.trim(),
            details: payment.detalles,
        })) as PagoCliente[];
    }

    async findById(id: string, gymId: string): Promise<PagoCliente | null> {
        return this.client.pagoCliente.findFirst({
            where: { pago_cliente_id: id, gym_id: gymId, is_deleted: false }
        });
    }

    async create(data: PagoCliente): Promise<void> {
        if (!data.gym_id) throw new Error("El token debe identificar el gimnasio del pago.");
        await this.client.pagoCliente.create({
            data: {
                pago_cliente_id: data.pago_cliente_id,
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
                recargo_mora_condonado_importe: data.recargo_mora_condonado_importe ?? null,
                recargo_mora_condonado_motivo: data.recargo_mora_condonado_motivo ?? null,
                recargo_mora_condonado_por: data.recargo_mora_condonado_por ?? null,
                id_entrenador: data.id_entrenador ?? null,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<PagoCliente>): Promise<void> {
        const result = await this.client.pagoCliente.updateMany({
            where: { pago_cliente_id: id, gym_id: gymId, is_deleted: false },
            data: {
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
                recargo_mora_condonado_importe: data.recargo_mora_condonado_importe ?? null,
                recargo_mora_condonado_motivo: data.recargo_mora_condonado_motivo ?? null,
                recargo_mora_condonado_por: data.recargo_mora_condonado_por ?? null,
                id_entrenador: data.id_entrenador ?? undefined,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
            }
        });
        if (result.count !== 1) throw new Error("PagoCliente not found");
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await softDeleteGymScopedSyncRecord({
            delegate: this.client.pagoCliente,
            entity: "pago_cliente",
            pk: "pago_cliente_id",
            id,
            gymId,
            now,
        });
    }

    async processPayment(
        pago: PagoCliente,
        detalles: DetallePago[],
        plan: PlanesPago,
        membershipId?: string | null,
        installment?: InstallmentPaymentIntent | null,
    ): Promise<void> {
        await this.runInClient(async (tx) => {
            const gymId = pago.gym_id;
            if (!gymId) {
                throw new Error("El pago requiere un gimnasio obtenido del token.");
            }
            const occurredAt = pago.fecha ?? trustedClock.nowUtc();
            const cliente = await tx.cliente.findFirst({
                where: { ci: pago.ci, gym_id: gymId, is_deleted: false },
            });
            if (!cliente) {
                throw new PaymentRuleError(`Cliente con CI ${pago.ci} no encontrado al procesar pago.`);
            }

            // La fecha de negocio se resuelve antes de las dos ramas: el
            // recargo por mora de una cuota se mide contra ella.
            const gym = await tx.gym.findUnique({
                where: { gym_id: gymId },
                select: { timezone: true },
            });
            const parts = datePartsInZone(
                gym?.timezone ?? env.defaultGymTimezone,
                occurredAt,
            );
            const businessToday = new Date(
                Date.UTC(parts.year, parts.month - 1, parts.day),
            );

            // R5.2 — pago de una cuota siguiente de una membresía ya activa.
            // Se resuelve entero aquí dentro, en la misma transacción, porque
            // el importe y el recargo dependen de la cuota real.
            const numeroCuota = Number(installment?.numeroCuota ?? 0);
            if (installment && numeroCuota > 1) {
                await this.payNextInstallmentInTx(tx, {
                    pago,
                    detalles,
                    plan,
                    cliente,
                    gymId,
                    membershipId: membershipId ?? null,
                    numeroCuota,
                    businessToday,
                    occurredAt,
                    intent: installment,
                });
                return;
            }

            let membership = membershipId
                ? await tx.membresiaCliente.findFirst({
                    where: { membresia_id: membershipId, gym_id: gymId },
                })
                : await tx.membresiaCliente.findFirst({
                    where: {
                        ci: pago.ci,
                        id_planes_pago: plan.id_planes_pago,
                        estado: "PENDIENTE_PAGO",
                        is_deleted: false,
                        gym_id: gymId,
                    },
                    orderBy: { created_at: "desc" },
                });

            let membershipOperation = "UPDATE";
            if (membership) {
                if (
                    membership.ci !== pago.ci ||
                    membership.id_planes_pago !== plan.id_planes_pago ||
                    membership.is_deleted
                ) {
                    throw new PaymentRuleError("La membresía no corresponde al cliente y plan del cobro.");
                }
                if (membership.estado !== "PENDIENTE_PAGO") {
                    throw new PaymentRuleError("La membresía seleccionada ya fue activada o no admite cobros.");
                }
            } else {
                membershipOperation = "INSERT";
                membership = await tx.membresiaCliente.create({
                    data: {
                        membresia_id: randomUUID(),
                        ci: pago.ci,
                        id_planes_pago: plan.id_planes_pago,
                        id_entrenador: pago.id_entrenador ?? cliente.id_entrenador ?? null,
                        plan_nombre_snapshot:
                            plan.nombre_plan_pago?.trim() || plan.id_planes_pago,
                        precio_snapshot: plan.importe_plan_pago,
                        moneda_id: plan.moneda_id,
                        duracion_dias_snapshot: plan.duracion_plan_pago,
                        fecha_inicio: cliente.fecha_inicio,
                        fecha_fin: cliente.fecha_fin,
                        estado: "PENDIENTE_PAGO",
                        origen: "RENOVACION",
                        importe_pagado: 0,
                        activada_at: null,
                        reconstruida: false,
                        confianza_reconstruccion: null,
                        is_deleted: false,
                        created_at: occurredAt,
                        gym_id: gymId,
                        source_device: "WEB_ADMIN",
                        version: 1,
                        updated_at: occurredAt,
                        deleted_at: null,
                    },
                });
            }

            const contracted = Number(membership.precio_snapshot);
            const previouslyApplied = Number(membership.importe_pagado ?? 0);
            // R5.2 — contratando por cuotas, lo exigido es la cuota 1, no el
            // plan entero: la cuota 1 activa la membresía y el resto queda
            // pendiente. Sin cuotas, se exige el saldo del plan.
            const firstTranche = installment
                ? await this.firstTrancheAmount(tx, gymId, plan)
                : null;
            const cashRequired = firstTranche
                ?? membershipCashRequired(contracted, previouslyApplied);
            // Recargo por mora. Sin cuotas ya viene congelado en el snapshot del
            // detalle (mismo valor en todos, así que se toma uno y no se suman).
            // Por cuotas se cotiza aquí dentro, sobre el importe de la cuota 1 y
            // contra el fin de cobertura vigente del cliente.
            const installmentMora = installment
                ? this.quoteInstallmentSurcharge({
                    plan,
                    base: cashRequired,
                    businessToday,
                    dueDate: cliente.fecha_fin,
                    intent: installment,
                })
                : null;
            const recargoCobrado = installmentMora
                ? installmentMora.recargoCobrado
                : Number(
                    detalles.find((d) => d.recargo_mora_importe != null)
                        ?.recargo_mora_importe ?? 0,
                );

            if (installment) {
                // Exactitud: la cuota 1 más su recargo, ni más ni menos.
                const exigido = cashRequired + recargoCobrado;
                if (Math.abs(exigido - Number(installment.paidAmount)) > 0.009) {
                    throw new PaymentRuleError(
                        `La cuota 1 requiere ${exigido.toFixed(2)} ${membership.moneda_id}` +
                        `${recargoCobrado > 0 ? ` (incluye recargo por mora ${installmentMora?.quote?.recargo})` : ""}.`,
                    );
                }
            } else if (!isFullPayment(pago.monto_total, cashRequired)) {
                throw new PaymentRuleError(
                    `El cobro pendiente requiere ${cashRequired.toFixed(2)} ${membership.moneda_id}.`,
                );
            }

            const current = await tx.membresiaCliente.findFirst({
                where: {
                    ci: pago.ci,
                    gym_id: gymId,
                    estado: "ACTIVA",
                    is_deleted: false,
                    membresia_id: { not: membership.membresia_id },
                    fecha_fin: { gt: businessToday },
                },
                orderBy: { fecha_fin: "desc" },
            });
            const projectedActiveEnd = current?.fecha_fin
                ?? (cliente.activo && cliente.fecha_fin > businessToday
                    ? cliente.fecha_fin
                    : null);
            const period = resolveServicePeriod({
                plannedStart: membership.fecha_inicio,
                activeMembershipEnd: projectedActiveEnd,
                businessToday,
                durationDays: membership.duracion_dias_snapshot,
            });

            membership = await tx.membresiaCliente.update({
                where: { membresia_id: membership.membresia_id },
                data: {
                    fecha_inicio: period.start,
                    // Por cuotas la cobertura llega solo hasta el final del
                    // tramo de la cuota 1; se amplía al pagar cada siguiente.
                    fecha_fin: period.endExclusive,
                    estado: "ACTIVA",
                    // Por cuotas se registra solo la BASE realmente cobrada. El
                    // recargo por mora se cobra pero es ingreso aparte y no
                    // paga plan (docs/RECARGO_MORA.md §6-ter).
                    importe_pagado: installment
                        ? cashRequired
                        : membership.precio_snapshot,
                    activada_at: occurredAt,
                    version: { increment: 1 },
                    updated_at: occurredAt,
                },
            });
            await this.recordSync(
                tx,
                "membresia_cliente",
                membershipOperation,
                membership.membresia_id,
                gymId,
                membership,
            );

            let assignment = await tx.membresiaEntrenadorAsignacion.findFirst({
                where: {
                    membresia_id: membership.membresia_id,
                    estado: { in: ["PENDIENTE", "ACTIVA"] },
                    is_deleted: false,
                    gym_id: gymId,
                },
            });
            if (membership.id_entrenador) {
                const assignmentOperation = assignment ? "UPDATE" : "INSERT";
                assignment = assignment
                    ? await tx.membresiaEntrenadorAsignacion.update({
                        where: { asignacion_id: assignment.asignacion_id },
                        data: {
                            fecha_inicio: period.start,
                            estado: "ACTIVA",
                            version: { increment: 1 },
                            updated_at: occurredAt,
                        },
                    })
                    : await tx.membresiaEntrenadorAsignacion.create({
                        data: {
                            asignacion_id: randomUUID(),
                            membresia_id: membership.membresia_id,
                            id_entrenador: membership.id_entrenador,
                            fecha_inicio: period.start,
                            fecha_fin: null,
                            estado: "ACTIVA",
                            motivo_cierre: null,
                            is_deleted: false,
                            created_at: occurredAt,
                            gym_id: gymId,
                            source_device: "WEB_ADMIN",
                            version: 1,
                            updated_at: occurredAt,
                            deleted_at: null,
                        },
                    });
                await this.recordSync(
                    tx,
                    "membresia_entrenador_asignacion",
                    assignmentOperation,
                    assignment.asignacion_id,
                    gymId,
                    assignment,
                );
            }

            const payment = await tx.pagoCliente.create({
                data: {
                    pago_cliente_id: pago.pago_cliente_id,
                    ci: pago.ci,
                    fecha: occurredAt,
                    // Total efectivamente cobrado = lo pendiente del plan + el
                    // recargo por mora. Sin sumar el recargo, la tesorería veía
                    // un detalle mayor que el encabezado y registraba la
                    // diferencia como cambio devuelto al socio.
                    monto_total: cashRequired + recargoCobrado,
                    id_entrenador: membership.id_entrenador,
                    id_planes_pago: membership.id_planes_pago,
                    moneda_id: membership.moneda_id,
                    // Condonación del recargo por mora (docs/RECARGO_MORA.md
                    // §6-bis): sin esto un cobro condonado desde la web no deja
                    // rastro y no puede aparecer en el cierre diario.
                    recargo_mora_condonado_importe:
                        installmentMora?.condonacion?.recargo_mora_condonado_importe
                        ?? pago.recargo_mora_condonado_importe ?? null,
                    recargo_mora_condonado_motivo:
                        installmentMora?.condonacion?.recargo_mora_condonado_motivo
                        ?? pago.recargo_mora_condonado_motivo ?? null,
                    recargo_mora_condonado_por:
                        installmentMora?.condonacion?.recargo_mora_condonado_por
                        ?? pago.recargo_mora_condonado_por ?? null,
                    // R5.6 — el cobrador ya viene resuelto y revalidado por el
                    // caso de uso; aquí solo se persiste con el resto.
                    ...collectorFromRow(pago),
                    gym_id: gymId,
                    source_device: "WEB_ADMIN",
                    version: pago.version,
                    created_at: occurredAt,
                    updated_at: occurredAt,
                    deleted_at: null,
                    is_deleted: false
                }
            });
            await this.recordSync(
                tx,
                "pago_cliente",
                "INSERT",
                payment.pago_cliente_id,
                gymId,
                payment,
            );

            const createdDetails: any[] = [];
            for (const d of detalles) {
                const detail = await tx.detallePago.create({
                    data: {
                        detalle_pago_id: d.detalle_pago_id,
                        pago_cliente_id: pago.pago_cliente_id,
                        tipo_pago_id: d.tipo_pago_id,
                        moneda_id: d.moneda_id,
                        cuenta_id: d.cuenta_id ?? null,
                        cantidad: d.cantidad,
                        tipo_cambio_id: d.tipo_cambio_id ?? null,
                        // Snapshot congelado del recargo por mora
                        // (docs/RECARGO_MORA.md): sin esto el cobro remoto no
                        // conserva con qué regla ni sobre qué base se cobró.
                        recargo_mora_modo_snapshot:
                            installmentMora?.applied?.modo ?? d.recargo_mora_modo_snapshot ?? null,
                        recargo_mora_dias_atraso:
                            installmentMora?.applied?.dias_atraso ?? d.recargo_mora_dias_atraso ?? null,
                        recargo_mora_base:
                            installmentMora?.applied?.base ?? d.recargo_mora_base ?? null,
                        recargo_mora_importe:
                            installmentMora?.applied?.recargo ?? d.recargo_mora_importe ?? null,
                        recargo_mora_plan_valor:
                            installmentMora?.planValor ?? d.recargo_mora_plan_valor ?? null,
                        recargo_mora_plan_tope:
                            installmentMora?.planTope ?? d.recargo_mora_plan_tope ?? null,
                        gym_id: gymId,
                        source_device: "WEB_ADMIN",
                        version: d.version,
                        created_at: occurredAt,
                        updated_at: occurredAt,
                        deleted_at: null,
                        is_deleted: false
                    },
                });
                await this.recordSync(
                    tx,
                    "detalle_pago",
                    "INSERT",
                    detail.detalle_pago_id,
                    gymId,
                    detail,
                );
                createdDetails.push(detail);
            }

            // R5.2 — contratación por cuotas: se materializan todas (la 1 queda
            // PAGADA) y la vigencia se acota al final de su tramo. Cada cuota
            // siguiente la amplía en `payInstallment`.
            if (installment) {
                const materialized = await this.installments.materializeOnActivation(
                    tx,
                    {
                        gymId,
                        membershipId: membership.membresia_id,
                        planId: plan.id_planes_pago,
                        membershipStart: membership.fecha_inicio,
                        pagoDetalleId: createdDetails[0]?.detalle_pago_id ?? null,
                        paidQuota: 1,
                    },
                );
                membership = await tx.membresiaCliente.update({
                    where: { membresia_id: membership.membresia_id },
                    data: {
                        fecha_fin: materialized.firstTrancheEndExclusive,
                        version: { increment: 1 },
                        updated_at: occurredAt,
                    },
                });
                await this.recordSync(
                    tx,
                    "membresia_cliente",
                    "UPDATE",
                    membership.membresia_id,
                    gymId,
                    membership,
                );
            }

            await this.treasuryLedger.recordPaymentInTx(
                tx,
                gymId,
                payment,
                createdDetails,
            );

            const application = await tx.pagoMembresiaAplicacion.create({
                data: {
                    aplicacion_id: randomUUID(),
                    pago_cliente_id: payment.pago_cliente_id,
                    membresia_id: membership.membresia_id,
                    moneda_id: membership.moneda_id,
                    monto_aplicado: cashRequired,
                    is_deleted: false,
                    created_at: occurredAt,
                    gym_id: gymId,
                    source_device: "WEB_ADMIN",
                    version: 1,
                    updated_at: occurredAt,
                    deleted_at: null,
                },
            });
            await this.recordSync(
                tx,
                "pago_membresia_aplicacion",
                "INSERT",
                application.aplicacion_id,
                gymId,
                application,
            );

            const updatedClient = await tx.cliente.update({
                where: { ci: pago.ci },
                data: {
                    activo: true,
                    id_planes_pago: membership.id_planes_pago,
                    id_entrenador: membership.id_entrenador,
                    fecha_inicio: period.start,
                    // Por cuotas la cobertura del cliente es la de la membresía,
                    // ya acotada al tramo de la cuota 1.
                    fecha_fin: membership.fecha_fin,
                    version: { increment: 1 },
                    updated_at: occurredAt,
                }
            });
            await this.recordSync(
                tx,
                "cliente",
                "UPDATE",
                updatedClient.ci,
                gymId,
                updatedClient,
            );

            await this.createTrainerCommissionAccrual(tx, {
                payment,
                plan,
                trainerId: membership.id_entrenador,
                serviceStart: period.start,
                serviceEnd: period.endExclusive,
                gymId,
                occurredAt,
                membershipId: membership.membresia_id,
            });
        });
    }

    /**
     * Cotiza el recargo por mora de un cobro por cuotas y resuelve su posible
     * condonación. Se llama SIEMPRE dentro de la transacción del cobro: la base
     * es el importe real de la cuota, no el precio del plan.
     */
    private quoteInstallmentSurcharge(input: {
        plan: PlanesPago;
        base: number;
        businessToday: Date;
        dueDate: Date | null | undefined;
        intent: InstallmentPaymentIntent;
    }) {
        const config = normalizeRecargoMoraConfig({
            modo: (input.plan as any).recargo_mora_modo,
            valor: (input.plan as any).recargo_mora_valor,
            tope: (input.plan as any).recargo_mora_tope,
            activo: (input.plan as any).recargo_mora_activo,
        });
        const quote = config
            ? quoteRecargoMora({
                baseAmount: input.base.toFixed(2),
                diasAtraso: calcularDiasAtraso(input.businessToday, input.dueDate),
                // El recargo siempre se cotiza; condonarlo es la excepción.
                aplicar: true,
                config,
            })
            : null;

        const condonar = Boolean(input.intent.condonarRecargoMora);
        let condonacion: ReturnType<typeof buildRecargoMoraCondonacion> | null = null;
        if (condonar) {
            if (!quote?.aplicado) {
                throw new PaymentRuleError("No hay recargo por mora que condonar en este cobro.");
            }
            condonacion = buildRecargoMoraCondonacion({
                importeQueSeIbaACobrar: quote.recargo,
                motivo: input.intent.motivoCondonacionRecargo,
                condonadoPorUserId: input.intent.condonadoPorUserId ?? null,
            });
        }
        // El snapshot solo se congela cuando el recargo se COBRÓ de verdad.
        const applied = !condonar && quote?.aplicado ? quote : null;
        return {
            quote,
            condonacion,
            applied,
            recargoCobrado: condonar ? 0 : Number(quote?.recargo ?? 0),
            planValor: applied ? (config?.valor ?? null) : null,
            planTope: applied ? (config?.tope ?? null) : null,
        };
    }

    /**
     * Importe de la cuota 1 del plan. Es lo exigido al contratar por cuotas.
     * Rechaza el cobro si el plan no admite cuotas o no tiene esquema.
     */
    private async firstTrancheAmount(
        tx: Prisma.TransactionClient,
        gymId: string,
        plan: PlanesPago,
    ): Promise<number> {
        if (!(plan as any).acepta_cuotas) {
            throw new PaymentRuleError("El plan no admite pago por cuotas.");
        }
        const scheme = await this.installments.getScheme(tx, gymId, plan.id_planes_pago);
        if (scheme.length === 0) {
            throw new PaymentRuleError("El plan no tiene un esquema de cuotas definido.");
        }
        return Number(scheme[0]!.importe);
    }

    /**
     * R5.2 — cobro de una cuota siguiente de una membresía ya activa.
     *
     * No reactiva la membresía ni exige el precio del plan: valida contra la
     * cuota real y su recargo por mora, ambos resueltos aquí dentro para que
     * dos peticiones simultáneas no puedan cobrar la misma cuota dos veces.
     */
    private async payNextInstallmentInTx(
        tx: Prisma.TransactionClient,
        input: {
            pago: PagoCliente;
            detalles: DetallePago[];
            plan: PlanesPago;
            cliente: any;
            gymId: string;
            membershipId: string | null;
            numeroCuota: number;
            businessToday: Date;
            occurredAt: Date;
            intent: InstallmentPaymentIntent;
        },
    ) {
        const { pago, plan, gymId, numeroCuota, businessToday, occurredAt, intent } = input;

        if (!input.membershipId) {
            throw new PaymentRuleError("Para pagar una cuota hay que indicar la membresía.");
        }
        const membership = await tx.membresiaCliente.findFirst({
            where: {
                membresia_id: input.membershipId,
                ci: pago.ci,
                gym_id: gymId,
                is_deleted: false,
            },
        });
        if (!membership || membership.estado === "PENDIENTE_PAGO") {
            throw new PaymentRuleError("La membresía de la cuota no está activa.");
        }
        const cuota = await tx.membresiaCuota.findFirst({
            where: {
                membresia_id: input.membershipId,
                numero_cuota: numeroCuota,
                gym_id: gymId,
                is_deleted: false,
            },
        });
        if (!cuota) {
            throw new PaymentRuleError(`La cuota ${numeroCuota} no existe para esta membresía.`);
        }
        if (cuota.estado === "PAGADA" || cuota.estado === "ANTICIPADA") {
            throw new PaymentRuleError(`La cuota ${numeroCuota} ya está pagada.`);
        }
        if (cuota.estado === "ANULADA") {
            throw new PaymentRuleError(`La cuota ${numeroCuota} está anulada.`);
        }
        // Orden estricto: no se salta una cuota anterior sin pagar.
        const pendientesAnteriores = await tx.membresiaCuota.count({
            where: {
                membresia_id: input.membershipId,
                gym_id: gymId,
                is_deleted: false,
                numero_cuota: { lt: numeroCuota },
                estado: "PENDIENTE",
            },
        });
        if (pendientesAnteriores > 0) {
            throw new PaymentRuleError(
                `Hay ${pendientesAnteriores} cuota(s) anterior(es) sin pagar; se cobran en orden.`,
            );
        }

        // Recargo por mora sobre la cuota: la base es su importe y el atraso se
        // mide contra su `fecha_exigible` (docs/RECARGO_MORA.md §6-ter).
        const base = Number(cuota.importe);
        const moraConfig = normalizeRecargoMoraConfig({
            modo: (plan as any).recargo_mora_modo,
            valor: (plan as any).recargo_mora_valor,
            tope: (plan as any).recargo_mora_tope,
            activo: (plan as any).recargo_mora_activo,
        });
        const moraQuote = moraConfig
            ? quoteRecargoMora({
                baseAmount: base.toFixed(2),
                diasAtraso: calcularDiasAtraso(businessToday, cuota.fecha_exigible),
                aplicar: true,
                config: moraConfig,
            })
            : null;
        const condonar = Boolean(intent.condonarRecargoMora);
        let condonacion: ReturnType<typeof buildRecargoMoraCondonacion> | null = null;
        if (condonar) {
            if (!moraQuote?.aplicado) {
                throw new PaymentRuleError("No hay recargo por mora que condonar en este cobro.");
            }
            condonacion = buildRecargoMoraCondonacion({
                importeQueSeIbaACobrar: moraQuote.recargo,
                motivo: intent.motivoCondonacionRecargo,
                condonadoPorUserId: intent.condonadoPorUserId ?? null,
            });
        }
        const recargoCobrado = condonar ? 0 : Number(moraQuote?.recargo ?? 0);
        const exigido = base + recargoCobrado;
        if (Math.abs(exigido - Number(intent.paidAmount)) > 0.009) {
            throw new PaymentRuleError(
                `La cuota ${numeroCuota} requiere ${exigido.toFixed(2)} ${membership.moneda_id}` +
                `${recargoCobrado > 0 ? ` (incluye recargo por mora ${moraQuote?.recargo})` : ""}.`,
            );
        }
        const appliedMora = !condonar && moraQuote?.aplicado ? moraQuote : null;

        const payment = await tx.pagoCliente.create({
            data: {
                pago_cliente_id: pago.pago_cliente_id,
                ci: pago.ci,
                fecha: occurredAt,
                // Total cobrado = base de la cuota + recargo por mora.
                monto_total: exigido,
                id_entrenador: membership.id_entrenador,
                id_planes_pago: membership.id_planes_pago,
                moneda_id: membership.moneda_id,
                recargo_mora_condonado_importe:
                    condonacion?.recargo_mora_condonado_importe ?? null,
                recargo_mora_condonado_motivo:
                    condonacion?.recargo_mora_condonado_motivo ?? null,
                recargo_mora_condonado_por:
                    condonacion?.recargo_mora_condonado_por ?? null,
                ...collectorFromRow(pago),
                gym_id: gymId,
                source_device: "WEB_ADMIN",
                version: pago.version,
                created_at: occurredAt,
                updated_at: occurredAt,
                deleted_at: null,
                is_deleted: false,
            },
        });
        await this.recordSync(tx, "pago_cliente", "INSERT", payment.pago_cliente_id, gymId, payment);

        const createdDetails: any[] = [];
        for (const d of input.detalles) {
            const detail = await tx.detallePago.create({
                data: {
                    detalle_pago_id: d.detalle_pago_id,
                    pago_cliente_id: payment.pago_cliente_id,
                    tipo_pago_id: d.tipo_pago_id,
                    moneda_id: d.moneda_id,
                    cuenta_id: d.cuenta_id ?? null,
                    cantidad: d.cantidad,
                    tipo_cambio_id: d.tipo_cambio_id ?? null,
                    recargo_mora_modo_snapshot: appliedMora?.modo ?? null,
                    recargo_mora_dias_atraso: appliedMora?.dias_atraso ?? null,
                    recargo_mora_base: appliedMora?.base ?? null,
                    recargo_mora_importe: appliedMora?.recargo ?? null,
                    recargo_mora_plan_valor: appliedMora ? (moraConfig?.valor ?? null) : null,
                    recargo_mora_plan_tope: appliedMora ? (moraConfig?.tope ?? null) : null,
                    gym_id: gymId,
                    source_device: "WEB_ADMIN",
                    version: d.version,
                    created_at: occurredAt,
                    updated_at: occurredAt,
                    deleted_at: null,
                    is_deleted: false,
                },
            });
            await this.recordSync(tx, "detalle_pago", "INSERT", detail.detalle_pago_id, gymId, detail);
            createdDetails.push(detail);
        }

        // Marca la cuota y amplía la vigencia al final de su tramo.
        await this.installments.payInstallment(tx, {
            gymId,
            membershipId: membership.membresia_id,
            numeroCuota,
            pagoDetalleId: createdDetails[0]?.detalle_pago_id ?? null,
            nowUtc: occurredAt,
        });

        // El acumulado del plan crece solo con la BASE: el recargo es ingreso
        // aparte y no paga plan (docs/RECARGO_MORA.md §6-ter).
        const topped = await tx.membresiaCliente.update({
            where: { membresia_id: membership.membresia_id },
            data: {
                importe_pagado: { increment: base },
                version: { increment: 1 },
                updated_at: occurredAt,
            },
        });
        await this.recordSync(tx, "membresia_cliente", "UPDATE", topped.membresia_id, gymId, topped);

        await this.treasuryLedger.recordPaymentInTx(tx, gymId, payment, createdDetails);

        const application = await tx.pagoMembresiaAplicacion.create({
            data: {
                aplicacion_id: randomUUID(),
                pago_cliente_id: payment.pago_cliente_id,
                membresia_id: topped.membresia_id,
                moneda_id: topped.moneda_id,
                monto_aplicado: base,
                is_deleted: false,
                created_at: occurredAt,
                gym_id: gymId,
                source_device: "WEB_ADMIN",
                version: 1,
                updated_at: occurredAt,
                deleted_at: null,
            },
        });
        await this.recordSync(
            tx,
            "pago_membresia_aplicacion",
            "INSERT",
            application.aplicacion_id,
            gymId,
            application,
        );

        // La cobertura del cliente sigue a la de la membresía ya ampliada.
        const refreshed = await tx.membresiaCliente.findFirst({
            where: { membresia_id: topped.membresia_id, gym_id: gymId },
        });
        const updatedClient = await tx.cliente.update({
            where: { ci: pago.ci },
            data: {
                activo: true,
                fecha_fin: refreshed?.fecha_fin ?? topped.fecha_fin,
                version: { increment: 1 },
                updated_at: occurredAt,
            },
        });
        await this.recordSync(tx, "cliente", "UPDATE", updatedClient.ci, gymId, updatedClient);

        await this.createTrainerCommissionAccrual(tx, {
            payment,
            plan,
            trainerId: topped.id_entrenador,
            serviceStart: cuota.fecha_cobertura_inicio,
            serviceEnd: cuota.fecha_cobertura_fin,
            gymId,
            occurredAt,
            membershipId: topped.membresia_id,
        });
    }

    async createTrainerCommissionAccrual(
        tx: Prisma.TransactionClient,
        input: {
            payment: any;
            plan: PlanesPago;
            trainerId: string | null;
            serviceStart: Date;
            serviceEnd: Date;
            gymId: string;
            occurredAt: Date;
            membershipId: string;
            sourceType?: "PAGO_CLIENTE" | "CREDITO_MEMBRESIA";
            sourceId?: string | null;
        },
    ) {
        const { payment, plan, trainerId, serviceStart, serviceEnd, gymId, occurredAt } = input;
        if (!trainerId || !plan.incluye_entrenador) return;

        const profileService = new CompensationProfileService();
        const businessDate = await profileService.businessDateForInstant(tx, gymId, occurredAt);
        const profile = await profileService.effectiveForTrainer(
            tx,
            gymId,
            trainerId,
            businessDate,
        );
        if (profile?.modalidad === "FIJO") return;

        const ruleWhere = {
            id_planes_pago: plan.id_planes_pago,
            activo: true,
            is_deleted: false,
            gym_id: gymId,
            fecha_inicio: { lte: occurredAt },
            OR: [{ fecha_fin: null }, { fecha_fin: { gt: occurredAt } }],
        };
        const overrideRule = await tx.entrenadorComisionRegla.findFirst({
            where: { ...ruleWhere, id_entrenador: trainerId },
            orderBy: [
                { fecha_inicio: "desc" },
                { updated_at: "desc" },
                { regla_id: "desc" },
            ],
        });
        const defaultRule = overrideRule ?? await tx.entrenadorComisionRegla.findFirst({
            where: { ...ruleWhere, id_entrenador: null },
            orderBy: [
                { fecha_inicio: "desc" },
                { updated_at: "desc" },
                { regla_id: "desc" },
            ],
        });
        const type = defaultRule?.tipo_calculo ?? plan.comision_entrenador_tipo ?? "NONE";
        const value = Number(defaultRule?.valor_calculo ?? plan.comision_entrenador_valor ?? 0);
        if (type === "NONE" || value <= 0) return;

        const base = Number(payment.monto_total);
        const totalRaw = type === "PERCENTAGE" ? base * (value / 100) : value;
        if (totalRaw <= 0) return;
        const rounded = (amount: number) => Math.round(amount * 100) / 100;
        const total = rounded(totalRaw);
        const schedule = profile
            ? buildCommissionSchedule({
                totalAmount: total.toFixed(2),
                serviceStart,
                serviceEnd,
                earningMethod: profile.metodo_devengo as "PERIODOS_IGUALES" | "DIAS_SERVICIO",
                payoutFrequency: profile.frecuencia_desembolso as "DIARIA" | "SEMANAL" | "QUINCENAL" | "MENSUAL" | "EXTRAORDINARIA",
                cutoffDay: profile.dia_corte,
            })
            : null;
        const installments = schedule?.length
            ?? this.commissionInstallmentCount(plan.duracion_plan_pago);
        const devengo = await tx.entrenadorComisionDevengo.create({
            data: {
                devengo_id: randomUUID(),
                pago_cliente_id: payment.pago_cliente_id,
                membresia_id: input.membershipId,
                fuente_tipo: input.sourceType ?? "PAGO_CLIENTE",
                fuente_id: input.sourceId ?? payment.pago_cliente_id,
                id_entrenador: trainerId,
                id_planes_pago: plan.id_planes_pago,
                moneda_id: payment.moneda_id,
                monto_base: base,
                tipo_calculo: type,
                valor_calculo: value,
                monto_total: total,
                cuotas_total: installments,
                cuotas_pagadas: 0,
                estado: "PENDIENTE",
                fecha_inicio_servicio: serviceStart,
                fecha_fin_servicio: serviceEnd,
                perfil_compensacion_id: profile?.perfil_id ?? null,
                modalidad_compensacion: profile?.modalidad ?? null,
                metodo_devengo: profile?.metodo_devengo ?? null,
                frecuencia_desembolso: profile?.frecuencia_desembolso ?? null,
                dia_corte: profile?.dia_corte ?? null,
                cuenta_preferida_id: profile?.cuenta_preferida_id ?? null,
                is_deleted: false,
                created_at: occurredAt,
                gym_id: gymId,
                source_device: "WEB_ADMIN",
                version: 1,
                updated_at: occurredAt,
                deleted_at: null,
            },
        });
        await this.recordSync(tx, "entrenador_comision_devengo", "INSERT", devengo.devengo_id, gymId, devengo);

        let assigned = 0;
        for (let index = 0; index < installments; index++) {
            const scheduled = schedule?.[index];
            const amount = scheduled
                ? Number(scheduled.amount)
                : index === installments - 1
                    ? rounded(total - assigned)
                    : rounded(total / installments);
            assigned = rounded(assigned + amount);
            const periodStart = scheduled?.periodStart ?? this.addUtcMonths(serviceStart, index);
            const periodEnd = scheduled?.periodEnd
                ?? (index === installments - 1
                    ? serviceEnd
                    : this.addUtcMonths(serviceStart, index + 1));
            const installment = await tx.entrenadorComisionCuota.create({
                data: {
                    cuota_id: randomUUID(),
                    devengo_id: devengo.devengo_id,
                    id_entrenador: trainerId,
                    moneda_id: payment.moneda_id,
                    periodo_inicio: periodStart,
                    periodo_fin: periodEnd,
                    fecha_programada: scheduled?.payableDate ?? periodEnd,
                    monto: amount,
                    estado: "PENDIENTE",
                    fecha_pago: null,
                    cuenta_id: null,
                    notas: null,
                    is_deleted: false,
                    created_at: occurredAt,
                    gym_id: gymId,
                    source_device: "WEB_ADMIN",
                    version: 1,
                    updated_at: occurredAt,
                    deleted_at: null,
                },
            });
            await this.recordSync(tx, "entrenador_comision_cuota", "INSERT", installment.cuota_id, gymId, installment);
        }
    }

    private commissionInstallmentCount(durationDays: number) {
        if (durationDays >= 360) return 12;
        if (durationDays <= 31) return 1;
        return Math.max(1, Math.ceil(durationDays / 30));
    }

    private addUtcMonths(date: Date, months: number) {
        const result = new Date(date);
        result.setUTCMonth(result.getUTCMonth() + months);
        return result;
    }

    private async recordSync(
        tx: Prisma.TransactionClient,
        entity: string,
        operation: string,
        entityId: string,
        gymId: string,
        payload: unknown,
    ) {
        await tx.syncLog.create({
            data: {
                event_id: randomUUID(),
                entidad: entity,
                operacion: operation,
                entidad_id: entityId,
                gym_id: gymId,
                device_id: null,
                payload_json: JSON.stringify(serialize(payload)),
            },
        });
    }
}
