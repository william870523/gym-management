import type { Context } from "hono";
import { logger } from "../../../config/logger";
import { serialize } from "../../../shared/utils/serialize";
import { PrismaClienteRepository } from "../../repositories/PrismaClienteRepository";
import { PrismaClientePesoRepository } from "../../repositories/PrismaClientePesoRepository";
import { CreateClienteUseCase } from "../../../application/use-cases/cliente/CreateClienteUseCase";
import { UpdateClienteUseCase } from "../../../application/use-cases/cliente/UpdateClienteUseCase";
import { DeleteClienteUseCase } from "../../../application/use-cases/cliente/DeleteClienteUseCase";
import { GetClienteUseCase } from "../../../application/use-cases/cliente/GetClienteUseCase";
import { ListClientesUseCase } from "../../../application/use-cases/cliente/ListClientesUseCase";
import { CreateClienteSchema, UpdateClienteSchema } from "../../../application/dtos/ClienteDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";
import { PrismaClienteExpedienteRepository } from "../../repositories/PrismaClienteExpedienteRepository";
import { GetClienteExpedienteUseCase } from "../../../application/use-cases/cliente/GetClienteExpedienteUseCase";
import {
    MembershipPauseError,
    MembershipPauseService,
} from "../../../application/membership/membership-pause.service";

export class ClienteController {
    private createUseCase: CreateClienteUseCase;
    private updateUseCase: UpdateClienteUseCase;
    private deleteUseCase: DeleteClienteUseCase;
    private getUseCase: GetClienteUseCase;
    private listUseCase: ListClientesUseCase;
    private recordUseCase: GetClienteExpedienteUseCase;
    private membershipPauseService: MembershipPauseService;

    constructor() {
        const repository = new PrismaClienteRepository();
        const syncLogRepository = new PrismaSyncLogRepository();
        const clientePesoRepository = new PrismaClientePesoRepository();

        this.createUseCase = new CreateClienteUseCase(repository, syncLogRepository, clientePesoRepository);
        this.updateUseCase = new UpdateClienteUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteClienteUseCase(repository, syncLogRepository);
        this.getUseCase = new GetClienteUseCase(repository);
        this.listUseCase = new ListClientesUseCase(repository);
        this.recordUseCase = new GetClienteExpedienteUseCase(
            new PrismaClienteExpedienteRepository(),
        );
        this.membershipPauseService = new MembershipPauseService();
    }

    async pauseMembership(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
        try {
            const body = await c.req.json();
            const result = await this.membershipPauseService.pause({
                gymId: auth.gymId,
                clientId: c.req.param("id"),
                membershipId: c.req.param("membershipId"),
                operationId: String(body.operation_id ?? ""),
                reason: String(body.motivo ?? ""),
                userId: auth.sub,
            });
            return c.json(serialize(result));
        } catch (error) {
            if (error instanceof MembershipPauseError) {
                return c.json({ error: error.message }, error.status as 400 | 404 | 409);
            }
            throw error;
        }
    }

    async resumeMembership(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
        try {
            const body = await c.req.json();
            const result = await this.membershipPauseService.resume({
                gymId: auth.gymId,
                clientId: c.req.param("id"),
                membershipId: c.req.param("membershipId"),
                operationId: String(body.operation_id ?? ""),
                userId: auth.sub,
            });
            return c.json(serialize(result));
        } catch (error) {
            if (error instanceof MembershipPauseError) {
                return c.json({ error: error.message }, error.status as 400 | 404 | 409);
            }
            throw error;
        }
    }

    async getRecord(c: Context) {
        try {
            const gymId = c.get("auth")?.gymId;
            if (!gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            const result = await this.recordUseCase.execute(
                c.req.param("id"),
                gymId,
            );
            if (!result) return c.json({ error: "Cliente not found" }, 404);
            return c.json(serialize(result));
        } catch (error) {
            logger.error("Error getting cliente record:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
            const response = result.map(cl => ({
                ...cl,
                foto_cliente: cl.foto_cliente ? Buffer.from(cl.foto_cliente).toString('base64') : null
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
                return c.json({ error: "Cliente not found" }, 404);
            }
            return c.json(serialize({
                ...result,
                foto_cliente: result.foto_cliente ? Buffer.from(result.foto_cliente).toString('base64') : null
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
                if (formData['foto_cliente_file'] && formData['foto_cliente_file'] instanceof File) {
                    const file = formData['foto_cliente_file'] as File;
                    body.foto_cliente = Buffer.from(await file.arrayBuffer());
                }
                // Cast types for DTO
                if (body.estatura_cliente) body.estatura_cliente = parseFloat(body.estatura_cliente);
                if (body.telefono) body.telefono = parseInt(body.telefono);
                if (body.activo) body.activo = body.activo === 'true' || body.activo === true;
            } else {
                body = await c.req.json();
            }

            const gymId = c.get("auth")?.gymId;
            if (!gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            body.gym_id = gymId;

            const validated = CreateClienteSchema.parse(body);
            const result = await this.createUseCase.execute(validated);

            return c.json(serialize({
                ...result,
                foto_cliente: result.foto_cliente ? Buffer.from(result.foto_cliente).toString('base64') : null
            }), 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            logger.error("Error creating cliente:", error);
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
                if (formData['foto_cliente_file'] && formData['foto_cliente_file'] instanceof File) {
                    const file = formData['foto_cliente_file'] as File;
                    body.foto_cliente = Buffer.from(await file.arrayBuffer());
                }
                if (body.estatura_cliente) body.estatura_cliente = parseFloat(body.estatura_cliente);
                if (body.telefono) body.telefono = parseInt(body.telefono);
                if (body.activo) body.activo = body.activo === 'true' || body.activo === true;
            } else {
                body = await c.req.json();
            }

            const validated = UpdateClienteSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "Cliente updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Cliente not found") {
                return c.json({ error: "Cliente not found" }, 404);
            }
            logger.error("Error updating cliente:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Cliente deleted successfully" });
        } catch (error: any) {
            if (error.message === "Cliente not found") {
                return c.json({ error: "Cliente not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
