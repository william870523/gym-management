import type { Context } from "hono";
import { PrismaAsistenciaRepository } from "../../repositories/PrismaAsistenciaRepository";
import { CreateAsistenciaUseCase } from "../../../application/use-cases/asistencia/CreateAsistenciaUseCase";
import { UpdateAsistenciaUseCase } from "../../../application/use-cases/asistencia/UpdateAsistenciaUseCase";
import { DeleteAsistenciaUseCase } from "../../../application/use-cases/asistencia/DeleteAsistenciaUseCase";
import { GetAsistenciaUseCase } from "../../../application/use-cases/asistencia/GetAsistenciaUseCase";
import { ListAsistenciasUseCase } from "../../../application/use-cases/asistencia/ListAsistenciasUseCase";
import { CreateAsistenciaSchema, UpdateAsistenciaSchema } from "../../../application/dtos/AsistenciaDTO";

export class AsistenciaController {
    private createUseCase: CreateAsistenciaUseCase;
    private updateUseCase: UpdateAsistenciaUseCase;
    private deleteUseCase: DeleteAsistenciaUseCase;
    private getUseCase: GetAsistenciaUseCase;
    private listUseCase: ListAsistenciasUseCase;

    constructor() {
        const repository = new PrismaAsistenciaRepository();
        this.createUseCase = new CreateAsistenciaUseCase(repository);
        this.updateUseCase = new UpdateAsistenciaUseCase(repository);
        this.deleteUseCase = new DeleteAsistenciaUseCase(repository);
        this.getUseCase = new GetAsistenciaUseCase(repository);
        this.listUseCase = new ListAsistenciasUseCase(repository);
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
                return c.json({ error: "Asistencia not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateAsistenciaSchema.parse(body);
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
            const validated = UpdateAsistenciaSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Asistencia updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Asistencia not found") {
                return c.json({ error: "Asistencia not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Asistencia deleted successfully" });
        } catch (error: any) {
            if (error.message === "Asistencia not found") {
                return c.json({ error: "Asistencia not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
