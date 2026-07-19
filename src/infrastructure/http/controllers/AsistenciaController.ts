import type { Context } from "hono";
import { PrismaAsistenciaRepository } from "../../repositories/PrismaAsistenciaRepository";
import { prisma } from "../../db/prismaClient";
import * as crypto from "crypto";
import { CreateAsistenciaUseCase } from "../../../application/use-cases/asistencia/CreateAsistenciaUseCase";
import { UpdateAsistenciaUseCase } from "../../../application/use-cases/asistencia/UpdateAsistenciaUseCase";
import { DeleteAsistenciaUseCase } from "../../../application/use-cases/asistencia/DeleteAsistenciaUseCase";
import { GetAsistenciaUseCase } from "../../../application/use-cases/asistencia/GetAsistenciaUseCase";
import { ListAsistenciasUseCase } from "../../../application/use-cases/asistencia/ListAsistenciasUseCase";
import { CreateAsistenciaSchema, UpdateAsistenciaSchema } from "../../../application/dtos/AsistenciaDTO";
import { trustedClock } from "../../../config/trusted-clock";

export class AsistenciaController {
    private createUseCase: CreateAsistenciaUseCase;
    private updateUseCase: UpdateAsistenciaUseCase;
    private deleteUseCase: DeleteAsistenciaUseCase;
    private getUseCase: GetAsistenciaUseCase;
    private listUseCase: ListAsistenciasUseCase;

    constructor() {
        const repository = new PrismaAsistenciaRepository();
        this.createUseCase = new CreateAsistenciaUseCase(repository);
        this.updateUseCase = new UpdateAsistenciaUseCase(repository);
        this.deleteUseCase = new DeleteAsistenciaUseCase(repository);
        this.getUseCase = new GetAsistenciaUseCase(repository);
        this.listUseCase = new ListAsistenciasUseCase(repository);
    }

    async list(c: Context) {
        try {
            const page = Number(c.req.query("page")) || 1;
            const limit = Math.min(Number(c.req.query("limit")) || 10, 200);
            const result = await this.listUseCase.execute(page, limit);
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async listActive(c: Context) {
        try {
            const page = Number(c.req.query("page")) || 1;
            const limit = Math.min(Number(c.req.query("limit")) || 100, 200);
            const skip = (page - 1) * limit;
            const result = await new PrismaAsistenciaRepository().findActive(skip, limit);
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async listToday(c: Context) {
        try {
            const auth = c.get("auth");
            const gymId = c.req.query("gym_id") ?? auth?.gymId ?? null;
            const result = await new PrismaAsistenciaRepository().findToday(gymId);
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getById(c: Context) {
        try {
            const id = c.req.param("id");
            const result = await this.getUseCase.execute(id);
            if (!result) {
                return c.json({ error: "Asistencia not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateAsistenciaSchema.parse(body);
            const gymId = c.get("auth")?.gymId;
            if (!gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }

            const memberships = await prisma.membresiaCliente.findMany({
                where: {
                    ci: validated.ci,
                    gym_id: gymId,
                    is_deleted: false,
                    estado: { in: ["ACTIVA", "PAUSADA", "PENDIENTE_PAGO"] },
                },
                select: { estado: true },
            });
            const hasActiveMembership = memberships.some(
                (membership) => membership.estado === "ACTIVA",
            );
            if (!hasActiveMembership && memberships.some(
                (membership) => membership.estado === "PAUSADA",
            )) {
                return c.json({
                    error: "La membresía está pausada. Reanúdala antes de registrar la entrada.",
                }, 409);
            }
            if (!hasActiveMembership && memberships.some(
                (membership) => membership.estado === "PENDIENTE_PAGO",
            )) {
                return c.json({
                    error: "La membresía está pendiente de pago. Registra el cobro antes de permitir la entrada.",
                }, 409);
            }

            // El gimnasio proviene del JWT; nunca se acepta el gym_id libre
            // que pueda enviar el cliente HTTP.
            const result = await this.createUseCase.execute({
                ...validated,
                gym_id: gymId,
            });

            await prisma.syncLog.create({
                data: {
                    event_id: crypto.randomUUID(),
                    entidad: "asistencia",
                    operacion: "INSERT",
                    entidad_id: result.asistencia_id,
                    gym_id: result.gym_id,
                    device_id: null,
                    payload_json: JSON.stringify(result),
                },
            });

            return c.json(result, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async finalize(c: Context) {
        try {
            const id = c.req.param("id");
            const repository = new PrismaAsistenciaRepository();
            const existing = await repository.findById(id);
            if (!existing) {
                return c.json({ error: "Asistencia not found" }, 404);
            }

            const result = await repository.finalize(id, trustedClock.nowUtc());

            await prisma.syncLog.create({
                data: {
                    event_id: crypto.randomUUID(),
                    entidad: "asistencia",
                    operacion: "UPDATE",
                    entidad_id: result.asistencia_id,
                    gym_id: result.gym_id,
                    device_id: null,
                    payload_json: JSON.stringify(result),
                },
            });

            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async update(c: Context) {
        try {
            const id = c.req.param("id");
            const body = await c.req.json();
            const validated = UpdateAsistenciaSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Asistencia updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Asistencia not found") {
                return c.json({ error: "Asistencia not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Asistencia deleted successfully" });
        } catch (error: any) {
            if (error.message === "Asistencia not found") {
                return c.json({ error: "Asistencia not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
