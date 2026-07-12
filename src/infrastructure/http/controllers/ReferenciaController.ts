import type { Context } from "hono";
import { PrismaReferenciaRepository } from "../../repositories/PrismaReferenciaRepository";
import { CreateReferenciaUseCase } from "../../../application/use-cases/referencia/CreateReferenciaUseCase";
import { UpdateReferenciaUseCase } from "../../../application/use-cases/referencia/UpdateReferenciaUseCase";
import { DeleteReferenciaUseCase } from "../../../application/use-cases/referencia/DeleteReferenciaUseCase";
import { GetReferenciaUseCase } from "../../../application/use-cases/referencia/GetReferenciaUseCase";
import { ListReferenciasUseCase } from "../../../application/use-cases/referencia/ListReferenciasUseCase";
import { CreateReferenciaSchema, UpdateReferenciaSchema } from "../../../application/dtos/ReferenciaDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";

export class ReferenciaController {
    private createUseCase: CreateReferenciaUseCase;
    private updateUseCase: UpdateReferenciaUseCase;
    private deleteUseCase: DeleteReferenciaUseCase;
    private getUseCase: GetReferenciaUseCase;
    private listUseCase: ListReferenciasUseCase;

    constructor() {
        const repository = new PrismaReferenciaRepository();
        const syncLogRepository = new PrismaSyncLogRepository();

        this.createUseCase = new CreateReferenciaUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateReferenciaUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteReferenciaUseCase(repository, syncLogRepository);
        this.getUseCase = new GetReferenciaUseCase(repository);
        this.listUseCase = new ListReferenciasUseCase(repository);
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
                return c.json({ error: "Referencia not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateReferenciaSchema.parse(body);
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
            const validated = UpdateReferenciaSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Referencia updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Referencia not found") {
                return c.json({ error: "Referencia not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Referencia deleted successfully" });
        } catch (error: any) {
            if (error.message === "Referencia not found") {
                return c.json({ error: "Referencia not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
