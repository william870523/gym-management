import type { Context } from "hono";
import { PrismaTipoPagoRepository } from "../../repositories/PrismaTipoPagoRepository";
import { CreateTipoPagoUseCase } from "../../../application/use-cases/tipo_pago/CreateTipoPagoUseCase";
import { UpdateTipoPagoUseCase } from "../../../application/use-cases/tipo_pago/UpdateTipoPagoUseCase";
import { DeleteTipoPagoUseCase } from "../../../application/use-cases/tipo_pago/DeleteTipoPagoUseCase";
import { GetTipoPagoUseCase } from "../../../application/use-cases/tipo_pago/GetTipoPagoUseCase";
import { ListTipoPagosUseCase } from "../../../application/use-cases/tipo_pago/ListTipoPagosUseCase";
import { CreateTipoPagoSchema, UpdateTipoPagoSchema } from "../../../application/dtos/TipoPagoDTO";

export class TipoPagoController {
    private createUseCase: CreateTipoPagoUseCase;
    private updateUseCase: UpdateTipoPagoUseCase;
    private deleteUseCase: DeleteTipoPagoUseCase;
    private getUseCase: GetTipoPagoUseCase;
    private listUseCase: ListTipoPagosUseCase;

    constructor() {
        const repository = new PrismaTipoPagoRepository();
        this.createUseCase = new CreateTipoPagoUseCase(repository);
        this.updateUseCase = new UpdateTipoPagoUseCase(repository);
        this.deleteUseCase = new DeleteTipoPagoUseCase(repository);
        this.getUseCase = new GetTipoPagoUseCase(repository);
        this.listUseCase = new ListTipoPagosUseCase(repository);
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
                return c.json({ error: "TipoPago not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateTipoPagoSchema.parse(body);
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
            const validated = UpdateTipoPagoSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "TipoPago updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "TipoPago not found") {
                return c.json({ error: "TipoPago not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "TipoPago deleted successfully" });
        } catch (error: any) {
            if (error.message === "TipoPago not found") {
                return c.json({ error: "TipoPago not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
