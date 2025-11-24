import type { Context } from "hono";
import { PrismaMonedaRepository } from "../../repositories/PrismaMonedaRepository";
import { CreateMonedaUseCase } from "../../../application/use-cases/moneda/CreateMonedaUseCase";
import { UpdateMonedaUseCase } from "../../../application/use-cases/moneda/UpdateMonedaUseCase";
import { DeleteMonedaUseCase } from "../../../application/use-cases/moneda/DeleteMonedaUseCase";
import { GetMonedaUseCase } from "../../../application/use-cases/moneda/GetMonedaUseCase";
import { ListMonedasUseCase } from "../../../application/use-cases/moneda/ListMonedasUseCase";
import { CreateMonedaSchema, UpdateMonedaSchema } from "../../../application/dtos/MonedaDTO";

export class MonedaController {
    private createUseCase: CreateMonedaUseCase;
    private updateUseCase: UpdateMonedaUseCase;
    private deleteUseCase: DeleteMonedaUseCase;
    private getUseCase: GetMonedaUseCase;
    private listUseCase: ListMonedasUseCase;

    constructor() {
        const repository = new PrismaMonedaRepository();
        this.createUseCase = new CreateMonedaUseCase(repository);
        this.updateUseCase = new UpdateMonedaUseCase(repository);
        this.deleteUseCase = new DeleteMonedaUseCase(repository);
        this.getUseCase = new GetMonedaUseCase(repository);
        this.listUseCase = new ListMonedasUseCase(repository);
    }

    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
            const response = result.map(m => ({
                ...m,
                imagen: m.imagen ? Buffer.from(m.imagen).toString('base64') : null
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
                return c.json({ error: "Moneda not found" }, 404);
            }
            return c.json({
                ...result,
                imagen: result.imagen ? Buffer.from(result.imagen).toString('base64') : null
            });
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateMonedaSchema.parse(body);
            const result = await this.createUseCase.execute(validated);
            return c.json({
                ...result,
                imagen: result.imagen ? Buffer.from(result.imagen).toString('base64') : null
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
            const validated = UpdateMonedaSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Moneda updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Moneda not found") {
                return c.json({ error: "Moneda not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Moneda deleted successfully" });
        } catch (error: any) {
            if (error.message === "Moneda not found") {
                return c.json({ error: "Moneda not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
