import type { Context } from "hono";
import { PrismaCuentaRepository } from "../../repositories/PrismaCuentaRepository";
import { CreateCuentaUseCase } from "../../../application/use-cases/cuenta/CreateCuentaUseCase";
import { UpdateCuentaUseCase } from "../../../application/use-cases/cuenta/UpdateCuentaUseCase";
import { DeleteCuentaUseCase } from "../../../application/use-cases/cuenta/DeleteCuentaUseCase";
import { GetCuentaUseCase } from "../../../application/use-cases/cuenta/GetCuentaUseCase";
import { ListCuentasUseCase } from "../../../application/use-cases/cuenta/ListCuentasUseCase";
import { CreateCuentaSchema, UpdateCuentaSchema } from "../../../application/dtos/CuentaDTO";

export class CuentaController {
    private createUseCase: CreateCuentaUseCase;
    private updateUseCase: UpdateCuentaUseCase;
    private deleteUseCase: DeleteCuentaUseCase;
    private getUseCase: GetCuentaUseCase;
    private listUseCase: ListCuentasUseCase;

    constructor() {
        const repository = new PrismaCuentaRepository();
        this.createUseCase = new CreateCuentaUseCase(repository);
        this.updateUseCase = new UpdateCuentaUseCase(repository);
        this.deleteUseCase = new DeleteCuentaUseCase(repository);
        this.getUseCase = new GetCuentaUseCase(repository);
        this.listUseCase = new ListCuentasUseCase(repository);
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
                return c.json({ error: "Cuenta not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateCuentaSchema.parse(body);
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
            const validated = UpdateCuentaSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Cuenta updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Cuenta not found") {
                return c.json({ error: "Cuenta not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Cuenta deleted successfully" });
        } catch (error: any) {
            if (error.message === "Cuenta not found") {
                return c.json({ error: "Cuenta not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
