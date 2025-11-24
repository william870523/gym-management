import type { PlanesPago } from "../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../domain/repositories/PlanesPagoRepository";
import { prisma } from "../db/prismaClient";

export class PrismaPlanesPagoRepository implements PlanesPagoRepository {
    async upsertPlanesPago(data: PlanesPago): Promise<void> {
        await prisma.planesPago.upsert({
            where: { id_planes_pago: data.id_planes_pago },
            create: {
                id_planes_pago: data.id_planes_pago,
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<PlanesPago[]> {
        return prisma.planesPago.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<PlanesPago | null> {
        return prisma.planesPago.findUnique({
            where: { id_planes_pago: id, is_deleted: false }
        });
    }

    async create(data: PlanesPago): Promise<void> {
        await prisma.planesPago.create({
            data: {
                id_planes_pago: data.id_planes_pago,
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<PlanesPago>): Promise<void> {
        await prisma.planesPago.update({
            where: { id_planes_pago: id },
            data: {
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? null,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.planesPago.update({
            where: { id_planes_pago: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
