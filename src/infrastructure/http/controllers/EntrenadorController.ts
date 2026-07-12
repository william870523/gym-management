import type { Context } from "hono";
import { logger } from "../../../config/logger";
import { serialize } from "../../../shared/utils/serialize";
import { PrismaEntrenadorRepository } from "../../repositories/PrismaEntrenadorRepository";
import { CreateEntrenadorUseCase } from "../../../application/use-cases/entrenador/CreateEntrenadorUseCase";
import { UpdateEntrenadorUseCase } from "../../../application/use-cases/entrenador/UpdateEntrenadorUseCase";
import { DeleteEntrenadorUseCase } from "../../../application/use-cases/entrenador/DeleteEntrenadorUseCase";
import { GetEntrenadorUseCase } from "../../../application/use-cases/entrenador/GetEntrenadorUseCase";
import { ListEntrenadoresUseCase } from "../../../application/use-cases/entrenador/ListEntrenadoresUseCase";
import { CreateEntrenadorSchema, UpdateEntrenadorSchema } from "../../../application/dtos/EntrenadorDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";

export class EntrenadorController {
    private createUseCase: CreateEntrenadorUseCase;
    private updateUseCase: UpdateEntrenadorUseCase;
    private deleteUseCase: DeleteEntrenadorUseCase;
    private getUseCase: GetEntrenadorUseCase;
    private listUseCase: ListEntrenadoresUseCase;

    constructor() {
        const repository = new PrismaEntrenadorRepository();
        const syncLogRepository = new PrismaSyncLogRepository();

        this.createUseCase = new CreateEntrenadorUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateEntrenadorUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteEntrenadorUseCase(repository, syncLogRepository);
        this.getUseCase = new GetEntrenadorUseCase(repository);
        this.listUseCase = new ListEntrenadoresUseCase(repository);
    }


    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
            const response = result.map(e => ({
                ...e,
                foto_entrenador: e.foto_entrenador ? Buffer.from(e.foto_entrenador).toString('base64') : null
            }));
            return c.json(serialize(response));
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getById(c: Context) {
        try {
            const id = c.req.param("id");
            const result = await this.getUseCase.execute(id);
            if (!result) {
                return c.json({ error: "Entrenador not found" }, 404);
            }
            return c.json(serialize({
                ...result,
                foto_entrenador: result.foto_entrenador ? Buffer.from(result.foto_entrenador).toString('base64') : null
            }));
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
                if (formData['foto_entrenador_file'] && formData['foto_entrenador_file'] instanceof File) {
                    const file = formData['foto_entrenador_file'] as File;
                    body.foto_entrenador = Buffer.from(await file.arrayBuffer());
                }
                // Handle version as number if present
                if (body.version) body.version = parseInt(body.version);
            } else {
                body = await c.req.json();
            }

            const validated = CreateEntrenadorSchema.parse(body);
            const result = await this.createUseCase.execute(validated);

            return c.json(serialize({
                ...result,
                foto_entrenador: result.foto_entrenador ? Buffer.from(result.foto_entrenador).toString('base64') : null
            }), 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            logger.error("Error creating entrenador:", error);
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
                if (formData['foto_entrenador_file'] && formData['foto_entrenador_file'] instanceof File) {
                    const file = formData['foto_entrenador_file'] as File;
                    body.foto_entrenador = Buffer.from(await file.arrayBuffer());
                }
                if (body.version) body.version = parseInt(body.version);
            } else {
                body = await c.req.json();
            }

            const validated = UpdateEntrenadorSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Entrenador updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Entrenador not found") {
                return c.json({ error: "Entrenador not found" }, 404);
            }
            logger.error("Error updating entrenador:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Entrenador deleted successfully" });
        } catch (error: any) {
            if (error.message === "Entrenador not found") {
                return c.json({ error: "Entrenador not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
