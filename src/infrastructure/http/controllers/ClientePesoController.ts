import type { Context } from "hono";
import { PrismaClientePesoRepository } from "../../repositories/PrismaClientePesoRepository";
import { prisma } from "../../db/prismaClient";
import * as crypto from "crypto";
import { CreateClientePesoUseCase } from "../../../application/use-cases/cliente_peso/CreateClientePesoUseCase";
import { UpdateClientePesoUseCase } from "../../../application/use-cases/cliente_peso/UpdateClientePesoUseCase";
import { DeleteClientePesoUseCase } from "../../../application/use-cases/cliente_peso/DeleteClientePesoUseCase";
import { GetClientePesoUseCase } from "../../../application/use-cases/cliente_peso/GetClientePesoUseCase";
import { ListClientePesosUseCase } from "../../../application/use-cases/cliente_peso/ListClientePesosUseCase";
import { CreateClientePesoSchema, UpdateClientePesoSchema } from "../../../application/dtos/ClientePesoDTO";

export class ClientePesoController {
    private createUseCase: CreateClientePesoUseCase;
    private updateUseCase: UpdateClientePesoUseCase;
    private deleteUseCase: DeleteClientePesoUseCase;
    private getUseCase: GetClientePesoUseCase;
    private listUseCase: ListClientePesosUseCase;

    constructor() {
        const repository = new PrismaClientePesoRepository();
        this.createUseCase = new CreateClientePesoUseCase(repository);
        this.updateUseCase = new UpdateClientePesoUseCase(repository);
        this.deleteUseCase = new DeleteClientePesoUseCase(repository);
        this.getUseCase = new GetClientePesoUseCase(repository);
        this.listUseCase = new ListClientePesosUseCase(repository);
    }

    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
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
            const validated = CreateClientePesoSchema.parse(body);
            const result = await this.createUseCase.execute(validated);

            await prisma.syncLog.create({
                data: {
                    event_id: crypto.randomUUID(),
                    entidad: "cliente_peso",
                    operacion: "INSERT",
                    entidad_id: result.cliente_peso_id,
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

    async update(c: Context) {
        try {
            const id = c.req.param("id");
            const body = await c.req.json();
            const validated = UpdateClientePesoSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
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
            await this.deleteUseCase.execute(id);
            return c.json({ message: "ClientePeso deleted successfully" });
        } catch (error: any) {
            if (error.message === "ClientePeso not found") {
                return c.json({ error: "ClientePeso not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
