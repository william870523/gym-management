import type { Context } from "hono";
import { PrismaCuentaRepository } from "../../repositories/PrismaCuentaRepository";
import { CreateCuentaUseCase } from "../../../application/use-cases/cuenta/CreateCuentaUseCase";
import { UpdateCuentaUseCase } from "../../../application/use-cases/cuenta/UpdateCuentaUseCase";
import { DeleteCuentaUseCase } from "../../../application/use-cases/cuenta/DeleteCuentaUseCase";
import { GetCuentaUseCase } from "../../../application/use-cases/cuenta/GetCuentaUseCase";
import { ListCuentasUseCase } from "../../../application/use-cases/cuenta/ListCuentasUseCase";
import { CreateCuentaSchema, UpdateCuentaSchema } from "../../../application/dtos/CuentaDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";

export class CuentaController {
    private createUseCase: CreateCuentaUseCase;
    private updateUseCase: UpdateCuentaUseCase;
    private deleteUseCase: DeleteCuentaUseCase;
    private getUseCase: GetCuentaUseCase;
    private listUseCase: ListCuentasUseCase;

    constructor() {
        const repository = new PrismaCuentaRepository();
        const syncLogRepository = new PrismaSyncLogRepository();

        this.createUseCase = new CreateCuentaUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateCuentaUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteCuentaUseCase(repository, syncLogRepository);
        this.getUseCase = new GetCuentaUseCase(repository);
        this.listUseCase = new ListCuentasUseCase(repository);
    }


    async list(c: Context) {
        try {
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.listUseCase.execute(gymId);
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getById(c: Context) {
        try {
            const id = c.req.param("id");
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.getUseCase.execute(id, gymId);
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
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.createUseCase.execute({
                ...validated,
                gym_id: gymId,
                source_device: "WEB_ADMIN",
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
            const validated = UpdateCuentaSchema.parse(body);
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            await this.updateUseCase.execute(id, validated, gymId);
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
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            await this.deleteUseCase.execute(id, gymId);
            return c.json({ message: "Cuenta deleted successfully" });
        } catch (error: any) {
            if (error.message === "Cuenta not found") {
                return c.json({ error: "Cuenta not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    private gymId(c: Context): string | null {
        const auth = c.get("auth");
        return auth?.gymId?.trim() || null;
    }
}
