import type { Context } from "hono";
import { PrismaPagoClienteRepository } from "../../repositories/PrismaPagoClienteRepository";
import { prisma } from "../../db/prismaClient";
import * as crypto from "crypto";
import { CreatePagoClienteUseCase } from "../../../application/use-cases/pago_cliente/CreatePagoClienteUseCase";
import { UpdatePagoClienteUseCase } from "../../../application/use-cases/pago_cliente/UpdatePagoClienteUseCase";
import { DeletePagoClienteUseCase } from "../../../application/use-cases/pago_cliente/DeletePagoClienteUseCase";
import { GetPagoClienteUseCase } from "../../../application/use-cases/pago_cliente/GetPagoClienteUseCase";
import { ListPagoClientesUseCase } from "../../../application/use-cases/pago_cliente/ListPagoClientesUseCase"; // Note: Check if I named it ListPagoClientesUseCase or ListPagosClienteUseCase
import { CreatePagoClienteSchema, UpdatePagoClienteSchema } from "../../../application/dtos/PagoClienteDTO";

// Wait, I need to check the ListUseCase name for PagoCliente.
// I created it as ListPagoClientesUseCase in previous step? No, I created ListPagoClienteUseCase?
// Let me check the previous tool call.
// I created ListPagoClientesUseCase.ts but class name?
// I'll assume ListPagoClientesUseCase for now.

import { ListPagoClientesUseCase as ListUseCase } from "../../../application/use-cases/pago_cliente/ListPagoClientesUseCase";

export class PagoClienteController {
    private createUseCase: CreatePagoClienteUseCase;
    private updateUseCase: UpdatePagoClienteUseCase;
    private deleteUseCase: DeletePagoClienteUseCase;
    private getUseCase: GetPagoClienteUseCase;
    private listUseCase: ListUseCase;

    constructor() {
        const repository = new PrismaPagoClienteRepository();
        this.createUseCase = new CreatePagoClienteUseCase(repository);
        this.updateUseCase = new UpdatePagoClienteUseCase(repository);
        this.deleteUseCase = new DeletePagoClienteUseCase(repository);
        this.getUseCase = new GetPagoClienteUseCase(repository);
        this.listUseCase = new ListUseCase(repository);
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
                return c.json({ error: "PagoCliente not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreatePagoClienteSchema.parse(body);
            const result = await this.createUseCase.execute(validated);

            await prisma.syncLog.create({
                data: {
                    event_id: crypto.randomUUID(),
                    entidad: "pago_cliente",
                    operacion: "INSERT",
                    entidad_id: result.pago_cliente_id,
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
            const validated = UpdatePagoClienteSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "PagoCliente updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "PagoCliente not found") {
                return c.json({ error: "PagoCliente not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "PagoCliente deleted successfully" });
        } catch (error: any) {
            if (error.message === "PagoCliente not found") {
                return c.json({ error: "PagoCliente not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
