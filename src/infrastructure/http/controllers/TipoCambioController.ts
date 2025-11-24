import type { Context } from "hono";
import { PrismaTipoCambioRepository } from "../../repositories/PrismaTipoCambioRepository";
import { CreateTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/CreateTipoCambioUseCase";
import { UpdateTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/UpdateTipoCambioUseCase";
import { DeleteTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/DeleteTipoCambioUseCase";
import { GetTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/GetTipoCambioUseCase";
import { ListTipoCambiosUseCase } from "../../../application/use-cases/tipo_cambio/ListTipoCambiosUseCase";
import { CreateTipoCambioSchema, UpdateTipoCambioSchema } from "../../../application/dtos/TipoCambioDTO";

export class TipoCambioController {
    private createUseCase: CreateTipoCambioUseCase;
    private updateUseCase: UpdateTipoCambioUseCase;
    private deleteUseCase: DeleteTipoCambioUseCase;
    private getUseCase: GetTipoCambioUseCase;
    private listUseCase: ListTipoCambiosUseCase;

    constructor() {
        const repository = new PrismaTipoCambioRepository();
        this.createUseCase = new CreateTipoCambioUseCase(repository);
        this.updateUseCase = new UpdateTipoCambioUseCase(repository);
        this.deleteUseCase = new DeleteTipoCambioUseCase(repository);
        this.getUseCase = new GetTipoCambioUseCase(repository);
        this.listUseCase = new ListTipoCambiosUseCase(repository);
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
                return c.json({ error: "TipoCambio not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateTipoCambioSchema.parse(body);
            const result = await this.createUseCase.execute(validated);
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
            const validated = UpdateTipoCambioSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "TipoCambio updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "TipoCambio not found") {
                return c.json({ error: "TipoCambio not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "TipoCambio deleted successfully" });
        } catch (error: any) {
            if (error.message === "TipoCambio not found") {
                return c.json({ error: "TipoCambio not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
