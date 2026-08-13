import type { Context } from "hono";
import { PrismaClientePesoRepository } from "../../repositories/PrismaClientePesoRepository";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";
import { prisma } from "../../db/prismaClient";
import * as crypto from "crypto";
import { CreateClientePesoUseCase } from "../../../application/use-cases/cliente_peso/CreateClientePesoUseCase";
import { UpdateClientePesoUseCase } from "../../../application/use-cases/cliente_peso/UpdateClientePesoUseCase";
import { DeleteClientePesoUseCase } from "../../../application/use-cases/cliente_peso/DeleteClientePesoUseCase";
import { GetClientePesoUseCase } from "../../../application/use-cases/cliente_peso/GetClientePesoUseCase";
import { ListClientePesosUseCase } from "../../../application/use-cases/cliente_peso/ListClientePesosUseCase";
import { CreateClientePesoSchema, UpdateClientePesoSchema } from "../../../application/dtos/ClientePesoDTO";
import { getUserGymActor } from "../middleware/auth.middleware";

export class ClientePesoController {
    private createUseCase: CreateClientePesoUseCase;
    private updateUseCase: UpdateClientePesoUseCase;
    private deleteUseCase: DeleteClientePesoUseCase;
    private getUseCase: GetClientePesoUseCase;
    private listUseCase: ListClientePesosUseCase;

    constructor() {
        const repository = new PrismaClientePesoRepository();
        // El evento del alta lo emite ahora el caso de uso, dentro de la misma
        // transacción que la fila.
        this.createUseCase = new CreateClientePesoUseCase(
            repository,
            new PrismaSyncLogRepository(),
        );
        this.updateUseCase = new UpdateClientePesoUseCase(repository);
        this.deleteUseCase = new DeleteClientePesoUseCase(repository);
        this.getUseCase = new GetClientePesoUseCase(repository);
        this.listUseCase = new ListClientePesosUseCase(repository);
    }

    async list(c: Context) {
        try {
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const ci = c.req.param("ci") || c.req.query("ci");
            if (!ci) {
                return c.json({ error: "Query parameter 'ci' is required" }, 400);
            }
            const result = await this.listUseCase.execute(actor.gymId, ci);
            return c.json(result);
        } catch (error: any) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getById(c: Context) {
        try {
            const id = c.req.param("id");
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.getUseCase.execute(id, actor.gymId);
            if (!result) {
                return c.json({ error: "ClientePeso not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const validated = CreateClientePesoSchema.parse(body);
            const result = await this.createUseCase.execute(validated, actor.gymId);


            return c.json(result, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (String(error.message).includes("no pertenece al gimnasio")) {
                return c.json({ error: error.message }, 400);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async update(c: Context) {
        try {
            const id = c.req.param("id");
            const body = await c.req.json();
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const validated = UpdateClientePesoSchema.parse(body);
            await this.updateUseCase.execute(id, validated, actor.gymId);
            return c.json({ message: "ClientePeso updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "ClientePeso not found") {
                return c.json({ error: "ClientePeso not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            await this.deleteUseCase.execute(id, actor.gymId);
            return c.json({ message: "ClientePeso deleted successfully" });
        } catch (error: any) {
            if (error.message === "ClientePeso not found") {
                return c.json({ error: "ClientePeso not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
