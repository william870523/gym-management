import type { Context } from "hono";
import { PrismaHorarioRepository } from "../../repositories/PrismaHorarioRepository";
import { CreateHorarioUseCase } from "../../../application/use-cases/horario/CreateHorarioUseCase";
import { UpdateHorarioUseCase } from "../../../application/use-cases/horario/UpdateHorarioUseCase";
import { DeleteHorarioUseCase } from "../../../application/use-cases/horario/DeleteHorarioUseCase";
import { GetHorarioUseCase } from "../../../application/use-cases/horario/GetHorarioUseCase";
import { ListHorariosUseCase } from "../../../application/use-cases/horario/ListHorariosUseCase";
import { CreateHorarioSchema, UpdateHorarioSchema } from "../../../application/dtos/HorarioDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class HorarioController {
    private createUseCase: CreateHorarioUseCase;
    private updateUseCase: UpdateHorarioUseCase;
    private deleteUseCase: DeleteHorarioUseCase;
    private getUseCase: GetHorarioUseCase;
    private listUseCase: ListHorariosUseCase;

    constructor(
        repository: HorarioRepository = new PrismaHorarioRepository(),
        syncLogRepository: SyncLogRepository = new PrismaSyncLogRepository(),
    ) {
        this.createUseCase = new CreateHorarioUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateHorarioUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteHorarioUseCase(repository, syncLogRepository);
        this.getUseCase = new GetHorarioUseCase(repository);
        this.listUseCase = new ListHorariosUseCase(repository);
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
                return c.json({ error: "Horario not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateHorarioSchema.parse(body);
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.createUseCase.execute(validated, gymId);
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
            const validated = UpdateHorarioSchema.parse(body);
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            await this.updateUseCase.execute(id, validated, gymId);
            return c.json({ message: "Horario updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Horario not found") {
                return c.json({ error: "Horario not found" }, 404);
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
            return c.json({ message: "Horario deleted successfully" });
        } catch (error: any) {
            if (error.message === "Horario not found") {
                return c.json({ error: "Horario not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    private gymId(c: Context): string | null {
        const auth = c.get("auth");
        return auth?.gymId?.trim() || null;
    }
}
