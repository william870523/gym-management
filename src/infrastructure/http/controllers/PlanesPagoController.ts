import type { Context } from "hono";
import { PrismaPlanesPagoRepository } from "../../repositories/PrismaPlanesPagoRepository";
import { CreatePlanesPagoUseCase } from "../../../application/use-cases/planes_pago/CreatePlanesPagoUseCase";
import { UpdatePlanesPagoUseCase } from "../../../application/use-cases/planes_pago/UpdatePlanesPagoUseCase";
import { DeletePlanesPagoUseCase } from "../../../application/use-cases/planes_pago/DeletePlanesPagoUseCase";
import { GetPlanesPagoUseCase } from "../../../application/use-cases/planes_pago/GetPlanesPagoUseCase";
import { ListPlanesPagosUseCase } from "../../../application/use-cases/planes_pago/ListPlanesPagosUseCase";
import { CreatePlanesPagoSchema, UpdatePlanesPagoSchema } from "../../../application/dtos/PlanesPagoDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class PlanesPagoController {
    private createUseCase: CreatePlanesPagoUseCase;
    private updateUseCase: UpdatePlanesPagoUseCase;
    private deleteUseCase: DeletePlanesPagoUseCase;
    private getUseCase: GetPlanesPagoUseCase;
    private listUseCase: ListPlanesPagosUseCase;

    constructor(
        repository: PlanesPagoRepository = new PrismaPlanesPagoRepository(),
        syncLogRepository: SyncLogRepository = new PrismaSyncLogRepository(),
    ) {
        this.createUseCase = new CreatePlanesPagoUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdatePlanesPagoUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeletePlanesPagoUseCase(repository, syncLogRepository);
        this.getUseCase = new GetPlanesPagoUseCase(repository);
        this.listUseCase = new ListPlanesPagosUseCase(repository);
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
                return c.json({ error: "PlanesPago not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreatePlanesPagoSchema.parse(body);
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
            const validated = UpdatePlanesPagoSchema.parse(body);
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            await this.updateUseCase.execute(id, validated, gymId);
            return c.json({ message: "PlanesPago updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "PlanesPago not found") {
                return c.json({ error: "PlanesPago not found" }, 404);
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
            return c.json({ message: "PlanesPago deleted successfully" });
        } catch (error: any) {
            if (error.message === "PlanesPago not found") {
                return c.json({ error: "PlanesPago not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    private gymId(c: Context): string | null {
        const auth = c.get("auth");
        return auth?.gymId?.trim() || null;
    }
}
