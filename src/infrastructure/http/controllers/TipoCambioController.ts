import type { Context } from "hono";
import { PrismaTipoCambioRepository } from "../../repositories/PrismaTipoCambioRepository";
import { CreateTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/CreateTipoCambioUseCase";
import { UpdateTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/UpdateTipoCambioUseCase";
import { DeleteTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/DeleteTipoCambioUseCase";
import { GetTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/GetTipoCambioUseCase";
import { ListTipoCambiosUseCase } from "../../../application/use-cases/tipo_cambio/ListTipoCambiosUseCase";
import { CreateTipoCambioSchema, UpdateTipoCambioSchema } from "../../../application/dtos/TipoCambioDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";

export class TipoCambioController {
    private createUseCase: CreateTipoCambioUseCase;
    private updateUseCase: UpdateTipoCambioUseCase;
    private deleteUseCase: DeleteTipoCambioUseCase;
    private getUseCase: GetTipoCambioUseCase;
    private listUseCase: ListTipoCambiosUseCase;

    constructor() {
        const repository = new PrismaTipoCambioRepository();
        const syncLogRepository = new PrismaSyncLogRepository();

        this.createUseCase = new CreateTipoCambioUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateTipoCambioUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteTipoCambioUseCase(repository, syncLogRepository);
        this.getUseCase = new GetTipoCambioUseCase(repository);
        this.listUseCase = new ListTipoCambiosUseCase(repository);
    }


    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
            // Convert nested currency images to Base64
            const mappedResult = (result as any[]).map(tc => ({
                ...tc,
                moneda_base: tc.moneda_base ? {
                    ...tc.moneda_base,
                    imagen: tc.moneda_base.imagen ? Buffer.from(tc.moneda_base.imagen).toString('base64') : null
                } : null,
                moneda_target: tc.moneda_target ? {
                    ...tc.moneda_target,
                    imagen: tc.moneda_target.imagen ? Buffer.from(tc.moneda_target.imagen).toString('base64') : null
                } : null,
            }));
            return c.json(mappedResult);
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
            const tc = result as any;
            const mappedResult = {
                ...tc,
                moneda_base: tc.moneda_base ? {
                    ...tc.moneda_base,
                    imagen: tc.moneda_base.imagen ? Buffer.from(tc.moneda_base.imagen).toString('base64') : null
                } : null,
                moneda_target: tc.moneda_target ? {
                    ...tc.moneda_target,
                    imagen: tc.moneda_target.imagen ? Buffer.from(tc.moneda_target.imagen).toString('base64') : null
                } : null,
            };
            return c.json(mappedResult);
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
            if (error.message?.includes("Same-currency")) {
                return c.json({ error: error.message }, 400);
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
            if (error.message?.includes("Same-currency")) {
                return c.json({ error: error.message }, 400);
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
