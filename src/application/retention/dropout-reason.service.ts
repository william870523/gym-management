/**
 * Catálogo de motivos de baja — gemelo remoto de
 * `gym-local-api/src/infrastructure/http/controllers/motivo_baja.controller.ts`
 * (docs/PLAN_ESTADISTICAS.md §7-ter).
 *
 * Mismas cuatro reglas que el local:
 *  1. **Ámbito por sede**, siempre desde el token, nunca del cuerpo.
 *  2. **Los de sistema no se borran**; se desactivan.
 *  3. **Borrar solo si nunca se usó**: un motivo ya registrado en una gestión
 *     dejaría bajas históricas sin explicación.
 *  4. **Desactivar no toca la historia**, solo oculta el motivo de gestiones
 *     nuevas.
 */
import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";

const DEVICE_ID = "WEB_ADMIN";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface MotivoBajaInput {
    motivo_baja_id?: string;
    nombre?: string;
    codigo?: string | null;
    orden?: number;
    activo?: boolean;
}

export class DropoutReasonService {
    async list(gymId: string, soloActivos = false) {
        const motivos = await prisma.motivoBaja.findMany({
            where: {
                gym_id: gymId,
                is_deleted: false,
                ...(soloActivos ? { activo: true } : {}),
            },
            orderBy: [{ orden: "asc" }, { nombre: "asc" }],
        });

        const usos = await prisma.retencionGestion.groupBy({
            by: ["motivo_baja_id"],
            where: { gym_id: gymId, is_deleted: false },
            _count: { _all: true },
        });
        const usoPorMotivo = new Map(
            usos
                .filter((fila) => fila.motivo_baja_id !== null)
                .map((fila) => [fila.motivo_baja_id as string, fila._count._all]),
        );

        return motivos.map((motivo) => ({
            ...motivo,
            gestiones: usoPorMotivo.get(motivo.motivo_baja_id) ?? 0,
        }));
    }

    async getById(gymId: string, motivoId: string) {
        const motivo = await prisma.motivoBaja.findFirst({
            where: { motivo_baja_id: motivoId, gym_id: gymId, is_deleted: false },
        });
        if (!motivo) return null;
        const gestiones = await prisma.retencionGestion.count({
            where: {
                motivo_baja_id: motivo.motivo_baja_id,
                gym_id: gymId,
                is_deleted: false,
            },
        });
        return { ...motivo, gestiones };
    }

    async create(gymId: string, input: MotivoBajaInput) {
        const nombre = String(input.nombre ?? "").trim();
        if (nombre === "") {
            throw new ReglaMotivoBaja("El nombre del motivo es obligatorio.", 400);
        }
        const duplicado = await prisma.motivoBaja.findFirst({
            where: { gym_id: gymId, nombre, is_deleted: false },
            select: { motivo_baja_id: true },
        });
        if (duplicado) {
            throw new ReglaMotivoBaja("Ya existe un motivo con ese nombre.", 409);
        }

        const now = trustedClock.nowUtc();
        return prisma.$transaction(async (tx) => {
            const creado = await tx.motivoBaja.create({
                data: {
                    motivo_baja_id: input.motivo_baja_id || randomUUID(),
                    gym_id: gymId,
                    nombre,
                    codigo: input.codigo ? String(input.codigo).trim() : null,
                    orden: Number.isFinite(Number(input.orden)) ? Number(input.orden) : 0,
                    activo: input.activo === undefined ? true : Boolean(input.activo),
                    // Nunca de sistema: lo contrario permitiría fabricarse un
                    // motivo indestructible desde el cuerpo de la petición.
                    es_sistema: false,
                    source_device: DEVICE_ID,
                    version: 1,
                    created_at: now,
                    updated_at: now,
                    is_deleted: false,
                },
            });
            await this.recordSync(tx, "INSERT", gymId, creado.motivo_baja_id, creado);
            return creado;
        });
    }

    async update(gymId: string, motivoId: string, input: MotivoBajaInput) {
        const existente = await prisma.motivoBaja.findFirst({
            where: { motivo_baja_id: motivoId, gym_id: gymId, is_deleted: false },
        });
        if (!existente) throw new ReglaMotivoBaja("Motivo de baja no encontrado.", 404);

        const nombre =
            input.nombre === undefined ? existente.nombre : String(input.nombre).trim();
        if (nombre === "") {
            throw new ReglaMotivoBaja("El nombre del motivo es obligatorio.", 400);
        }
        if (nombre !== existente.nombre) {
            const duplicado = await prisma.motivoBaja.findFirst({
                where: {
                    gym_id: gymId,
                    nombre,
                    is_deleted: false,
                    motivo_baja_id: { not: motivoId },
                },
                select: { motivo_baja_id: true },
            });
            if (duplicado) {
                throw new ReglaMotivoBaja("Ya existe un motivo con ese nombre.", 409);
            }
        }

        const now = trustedClock.nowUtc();
        return prisma.$transaction(async (tx) => {
            const actualizado = await tx.motivoBaja.update({
                where: { motivo_baja_id: motivoId },
                data: {
                    nombre,
                    codigo:
                        input.codigo === undefined
                            ? existente.codigo
                            : input.codigo
                              ? String(input.codigo).trim()
                              : null,
                    orden: input.orden === undefined ? existente.orden : Number(input.orden),
                    activo:
                        input.activo === undefined ? existente.activo : Boolean(input.activo),
                    // `es_sistema` no se edita: define quién puede borrarlo.
                    updated_at: now,
                    version: { increment: 1 },
                },
            });
            await this.recordSync(
                tx,
                "UPDATE",
                gymId,
                actualizado.motivo_baja_id,
                actualizado,
            );
            return actualizado;
        });
    }

    async remove(gymId: string, motivoId: string) {
        const existente = await prisma.motivoBaja.findFirst({
            where: { motivo_baja_id: motivoId, gym_id: gymId, is_deleted: false },
        });
        if (!existente) throw new ReglaMotivoBaja("Motivo de baja no encontrado.", 404);

        if (existente.es_sistema) {
            throw new ReglaMotivoBaja(
                "Los motivos base no se borran. Desactívalo si no quieres que " +
                    "aparezca en gestiones nuevas.",
                409,
            );
        }

        const usos = await prisma.retencionGestion.count({
            where: { motivo_baja_id: motivoId, is_deleted: false },
        });
        if (usos > 0) {
            throw new ReglaMotivoBaja(
                `Este motivo ya está registrado en ${usos} gestión(es). Borrarlo ` +
                    `dejaría esas bajas sin explicación: desactívalo en su lugar.`,
                409,
            );
        }

        const now = trustedClock.nowUtc();
        await prisma.$transaction(async (tx) => {
            const borrado = await tx.motivoBaja.update({
                where: { motivo_baja_id: motivoId },
                data: {
                    is_deleted: true,
                    deleted_at: now,
                    updated_at: now,
                    version: { increment: 1 },
                },
            });
            await this.recordSync(tx, "DELETE", gymId, borrado.motivo_baja_id, borrado);
        });
        return { ok: true };
    }

    private async recordSync(
        tx: Tx,
        operation: "INSERT" | "UPDATE" | "DELETE",
        gymId: string,
        entityId: string,
        row: unknown,
    ) {
        await tx.syncLog.create({
            data: {
                event_id: randomUUID(),
                entidad: "motivo_baja",
                operacion: operation,
                entidad_id: entityId,
                gym_id: gymId,
                device_id: DEVICE_ID,
                payload_json: JSON.stringify(serialize(row)),
            },
        });
    }
}

/** Error de regla del catálogo, con el estado HTTP que le corresponde. */
export class ReglaMotivoBaja extends Error {
    constructor(
        message: string,
        readonly status: 400 | 404 | 409,
    ) {
        super(message);
        this.name = "ReglaMotivoBaja";
    }
}
