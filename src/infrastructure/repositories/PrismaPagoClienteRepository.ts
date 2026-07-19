import type { PagoCliente } from "../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../domain/repositories/PagoClienteRepository";
import type { DetallePago } from "../../domain/entities/DetallePago";
import { prisma } from "../db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import type { PlanesPago } from "../../domain/entities/PlanesPago";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { datePartsInZone } from "../../config/tz";
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

export class PrismaPagoClienteRepository implements PagoClienteRepository {
    private readonly treasuryLedger = new TreasuryLedgerService();
    async upsertPagoCliente(data: PagoCliente): Promise<void> {
        await prisma.pagoCliente.upsert({
            where: { pago_cliente_id: data.pago_cliente_id },
            create: {
                pago_cliente_id: data.pago_cliente_id,
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
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
            },
            update: {
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
                id_entrenador: data.id_entrenador ?? null,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: trustedClock.nowUtc(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<PagoCliente[]> {
        const payments = await prisma.pagoCliente.findMany({
            orderBy: { fecha: "desc" },
            include: {
                cliente: {
                    select: {
                        nombres: true,
                        apellidos: true,
                    },
                },
                detalles: {
                    where: { is_deleted: false },
                },
            },
        });
        return payments.map((payment) => ({
            ...payment,
            clientName: `${payment.cliente.nombres ?? ""} ${payment.cliente.apellidos ?? ""}`.trim(),
            details: payment.detalles,
        })) as PagoCliente[];
    }

    async findById(id: string): Promise<PagoCliente | null> {
        return prisma.pagoCliente.findUnique({
            where: { pago_cliente_id: id, is_deleted: false }
        });
    }

    async create(data: PagoCliente): Promise<void> {
        await prisma.pagoCliente.create({
            data: {
                pago_cliente_id: data.pago_cliente_id,
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
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

    async update(id: string, data: Partial<PagoCliente>): Promise<void> {
        await prisma.pagoCliente.update({
            where: { pago_cliente_id: id },
            data: {
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
                id_entrenador: data.id_entrenador ?? undefined,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? undefined,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.pagoCliente.update({
            where: { pago_cliente_id: id },
            data: {
                is_deleted: true,
                deleted_at: trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc()
            }
        });
    }

    async processPayment(
        pago: PagoCliente,
        detalles: DetallePago[],
        plan: PlanesPago,
        membershipId?: string | null,
    ): Promise<void> {
        await prisma.$transaction(async (tx) => {
            const gymId = pago.gym_id;
            if (!gymId) {
                throw new Error("El pago requiere un gimnasio obtenido del token.");
            }
            const occurredAt = pago.fecha ?? trustedClock.nowUtc();
            const cliente = await tx.cliente.findFirst({
                where: { ci: pago.ci, gym_id: gymId, is_deleted: false },
            });
            if (!cliente) {
                throw new Error(`Cliente con CI ${pago.ci} no encontrado al procesar pago.`);
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
                    throw new Error("La membresía no corresponde al cliente y plan del cobro.");
                }
                if (membership.estado !== "PENDIENTE_PAGO") {
                    throw new Error("La membresía seleccionada ya fue activada o no admite cobros.");
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
            const cashRequired = membershipCashRequired(contracted, previouslyApplied);
            if (!isFullPayment(pago.monto_total, cashRequired)) {
                throw new Error(
                    `El cobro pendiente requiere ${cashRequired.toFixed(2)} ${membership.moneda_id}.`,
                );
            }

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
                    fecha_fin: period.endExclusive,
                    estado: "ACTIVA",
                    importe_pagado: membership.precio_snapshot,
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
                    monto_total: cashRequired,
                    id_entrenador: membership.id_entrenador,
                    id_planes_pago: membership.id_planes_pago,
                    moneda_id: membership.moneda_id,
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
                    fecha_fin: period.endExclusive,
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
