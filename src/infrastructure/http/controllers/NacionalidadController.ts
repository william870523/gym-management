import type { Context } from "hono";
import { logger } from "../../../config/logger";
import { PrismaNacionalidadRepository } from "../../repositories/PrismaNacionalidadRepository";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";

import { CreateNacionalidadUseCase } from "../../../application/use-cases/nacionalidad/CreateNacionalidadUseCase";
import { UpdateNacionalidadUseCase } from "../../../application/use-cases/nacionalidad/UpdateNacionalidadUseCase";
import { DeleteNacionalidadUseCase } from "../../../application/use-cases/nacionalidad/DeleteNacionalidadUseCase";
import { GetNacionalidadUseCase } from "../../../application/use-cases/nacionalidad/GetNacionalidadUseCase";
import { ListNacionalidadesUseCase } from "../../../application/use-cases/nacionalidad/ListNacionalidadesUseCase";
import { CreateNacionalidadSchema, UpdateNacionalidadSchema } from "../../../application/dtos/NacionalidadDTO";

export class NacionalidadController {
    private createUseCase: CreateNacionalidadUseCase;
    private updateUseCase: UpdateNacionalidadUseCase;
    private deleteUseCase: DeleteNacionalidadUseCase;
    private getUseCase: GetNacionalidadUseCase;
    private listUseCase: ListNacionalidadesUseCase;

    constructor() {
        const repository = new PrismaNacionalidadRepository();
        const syncLogRepository = new PrismaSyncLogRepository();
        this.createUseCase = new CreateNacionalidadUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateNacionalidadUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteNacionalidadUseCase(repository, syncLogRepository);
        this.getUseCase = new GetNacionalidadUseCase(repository);
        this.listUseCase = new ListNacionalidadesUseCase(repository);
    }


    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
            // Convert Uint8Array to Base64 for JSON response
            const response = result.map(n => ({
                ...n,
                bandera: n.bandera ? Buffer.from(n.bandera).toString('base64') : null
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
                return c.json({ error: "Nacionalidad not found" }, 404);
            }
            return c.json({
                ...result,
                bandera: result.bandera ? Buffer.from(result.bandera).toString('base64') : null
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
                // Handle the file if present
                if (formData['bandera_file'] && formData['bandera_file'] instanceof File) {
                    const file = formData['bandera_file'] as File;
                    body.bandera = Buffer.from(await file.arrayBuffer());
                }
            } else {
                body = await c.req.json();
            }

            const validated = CreateNacionalidadSchema.parse(body);
            const result = await this.createUseCase.execute(validated);

            return c.json({
                ...result,
                bandera: result.bandera ? Buffer.from(result.bandera).toString('base64') : null
            }, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            logger.error("Error creating nacionalidad:", error);
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
                // Handle the file if present
                if (formData['bandera_file'] && formData['bandera_file'] instanceof File) {
                    const file = formData['bandera_file'] as File;
                    body.bandera = Buffer.from(await file.arrayBuffer());
                }
            } else {
                body = await c.req.json();
            }

            const validated = UpdateNacionalidadSchema.parse(body);
            await this.updateUseCase.execute(id, validated);

            return c.json({ message: "Nacionalidad updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Nacionalidad not found") {
                return c.json({ error: "Nacionalidad not found" }, 404);
            }
            logger.error("Error updating nacionalidad:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Nacionalidad deleted successfully" });
        } catch (error: any) {
            if (error.message === "Nacionalidad not found") {
                return c.json({ error: "Nacionalidad not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
