import type { Context } from "hono";
import { PrismaDetallePagoRepository } from "../../repositories/PrismaDetallePagoRepository";
import { CreateDetallePagoUseCase } from "../../../application/use-cases/detalle_pago/CreateDetallePagoUseCase";
import { UpdateDetallePagoUseCase } from "../../../application/use-cases/detalle_pago/UpdateDetallePagoUseCase";
import { DeleteDetallePagoUseCase } from "../../../application/use-cases/detalle_pago/DeleteDetallePagoUseCase";
import { GetDetallePagoUseCase } from "../../../application/use-cases/detalle_pago/GetDetallePagoUseCase";
import { ListDetallePagosUseCase } from "../../../application/use-cases/detalle_pago/ListDetallePagosUseCase";
import { CreateDetallePagoSchema, UpdateDetallePagoSchema } from "../../../application/dtos/DetallePagoDTO";

export class DetallePagoController {
    private createUseCase: CreateDetallePagoUseCase;
    private updateUseCase: UpdateDetallePagoUseCase;
    private deleteUseCase: DeleteDetallePagoUseCase;
    private getUseCase: GetDetallePagoUseCase;
    private listUseCase: ListDetallePagosUseCase;

    constructor() {
        const repository = new PrismaDetallePagoRepository();
        this.createUseCase = new CreateDetallePagoUseCase(repository);
        this.updateUseCase = new UpdateDetallePagoUseCase(repository);
        this.deleteUseCase = new DeleteDetallePagoUseCase(repository);
        this.getUseCase = new GetDetallePagoUseCase(repository);
        this.listUseCase = new ListDetallePagosUseCase(repository);
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
                return c.json({ error: "DetallePago not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        try {
            const body = await c.req.json();
            const validated = CreateDetallePagoSchema.parse(body);
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
            const validated = UpdateDetallePagoSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "DetallePago updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "DetallePago not found") {
                return c.json({ error: "DetallePago not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "DetallePago deleted successfully" });
        } catch (error: any) {
            if (error.message === "DetallePago not found") {
                return c.json({ error: "DetallePago not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
