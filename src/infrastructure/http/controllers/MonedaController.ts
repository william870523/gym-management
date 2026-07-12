import type { Context } from "hono";
import { logger } from "../../../config/logger";
import { PrismaMonedaRepository } from "../../repositories/PrismaMonedaRepository";
import { CreateMonedaUseCase } from "../../../application/use-cases/moneda/CreateMonedaUseCase";
import { UpdateMonedaUseCase } from "../../../application/use-cases/moneda/UpdateMonedaUseCase";
import { DeleteMonedaUseCase } from "../../../application/use-cases/moneda/DeleteMonedaUseCase";
import { GetMonedaUseCase } from "../../../application/use-cases/moneda/GetMonedaUseCase";
import { ListMonedasUseCase } from "../../../application/use-cases/moneda/ListMonedasUseCase";
import { CreateMonedaSchema, UpdateMonedaSchema } from "../../../application/dtos/MonedaDTO";

import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";

export class MonedaController {
    private createUseCase: CreateMonedaUseCase;
    private updateUseCase: UpdateMonedaUseCase;
    private deleteUseCase: DeleteMonedaUseCase;
    private getUseCase: GetMonedaUseCase;
    private listUseCase: ListMonedasUseCase;

    constructor() {
        const repository = new PrismaMonedaRepository();
        const syncLogRepository = new PrismaSyncLogRepository();

        this.createUseCase = new CreateMonedaUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateMonedaUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteMonedaUseCase(repository, syncLogRepository);
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
            let body: any = {};
            const contentType = c.req.header("content-type") || "";

            if (contentType.includes("multipart/form-data")) {
                const formData = await c.req.parseBody();
                body = { ...formData };
                if (formData['imagen_file'] && formData['imagen_file'] instanceof File) {
                    const file = formData['imagen_file'] as File;
                    body.imagen = Buffer.from(await file.arrayBuffer());
                }
            } else {
                body = await c.req.json();
            }

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
            logger.error("Error creating moneda:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async update(c: Context) {
        try {
            const id = c.req.param("id");
            let body: any = {};
            const contentType = c.req.header("content-type") || "";

            if (contentType.includes("multipart/form-data")) {
                const formData = await c.req.parseBody();
                body = { ...formData };
                if (formData['imagen_file'] && formData['imagen_file'] instanceof File) {
                    const file = formData['imagen_file'] as File;
                    body.imagen = Buffer.from(await file.arrayBuffer());
                }
            } else {
                body = await c.req.json();
            }

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
            logger.error("Error updating moneda:", error);
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
