import type { Context } from "hono";
import { PrismaClienteRepository } from "../../repositories/PrismaClienteRepository";
import { CreateClienteUseCase } from "../../../application/use-cases/cliente/CreateClienteUseCase";
import { UpdateClienteUseCase } from "../../../application/use-cases/cliente/UpdateClienteUseCase";
import { DeleteClienteUseCase } from "../../../application/use-cases/cliente/DeleteClienteUseCase";
import { GetClienteUseCase } from "../../../application/use-cases/cliente/GetClienteUseCase";
import { ListClientesUseCase } from "../../../application/use-cases/cliente/ListClientesUseCase";
import { CreateClienteSchema, UpdateClienteSchema } from "../../../application/dtos/ClienteDTO";
import { prisma } from "../../db/prismaClient";

export class ClienteController {
    private createUseCase: CreateClienteUseCase;
    private updateUseCase: UpdateClienteUseCase;
    private deleteUseCase: DeleteClienteUseCase;
    private getUseCase: GetClienteUseCase;
    private listUseCase: ListClientesUseCase;

    constructor() {
        const repository = new PrismaClienteRepository();
        this.createUseCase = new CreateClienteUseCase(repository);
        this.updateUseCase = new UpdateClienteUseCase(repository);
        this.deleteUseCase = new DeleteClienteUseCase(repository);
        this.getUseCase = new GetClienteUseCase(repository);
        this.listUseCase = new ListClientesUseCase(repository);
    }

    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
            const response = result.map(cl => ({
                ...cl,
                foto_cliente: cl.foto_cliente ? Buffer.from(cl.foto_cliente).toString('base64') : null
            }));
            return c.json(response);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getById(c: Context) {
        try {
            const id = c.req.param("id");
            const result = await this.getUseCase.execute(id);
            if (!result) {
                return c.json({ error: "Cliente not found" }, 404);
            }
            return c.json({
                ...result,
                foto_cliente: result.foto_cliente ? Buffer.from(result.foto_cliente).toString('base64') : null
            });
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const parsed = CreateClienteSchema.safeParse(body);
            if (!parsed.success) {
                return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);
            }

            const result = await this.createUseCase.execute(parsed.data);

            await prisma.syncLog.create({
                data: {
                    event_id: crypto.randomUUID(),
                    entidad: "cliente",
                    operacion: "INSERT",
                    entidad_id: result.ci,
                    gym_id: result.gym_id,
                    device_id: null,
                    payload_json: JSON.stringify(result),
                },
            });

            return c.json({
                ...result,
                foto_cliente: result.foto_cliente ? Buffer.from(result.foto_cliente).toString('base64') : null
            }, 201);
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
            const validated = UpdateClienteSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Cliente updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Cliente not found") {
                return c.json({ error: "Cliente not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Cliente deleted successfully" });
        } catch (error: any) {
            if (error.message === "Cliente not found") {
                return c.json({ error: "Cliente not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
