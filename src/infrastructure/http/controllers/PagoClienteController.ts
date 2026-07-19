import type { Context } from "hono";
import { PrismaPagoClienteRepository } from "../../repositories/PrismaPagoClienteRepository";
import { prisma } from "../../db/prismaClient";
import * as crypto from "crypto";
import { CreatePagoClienteUseCase } from "../../../application/use-cases/pago_cliente/CreatePagoClienteUseCase";
import { UpdatePagoClienteUseCase } from "../../../application/use-cases/pago_cliente/UpdatePagoClienteUseCase";
import { GetPagoClienteUseCase } from "../../../application/use-cases/pago_cliente/GetPagoClienteUseCase";
import { ListPagoClientesUseCase as ListUseCase } from "../../../application/use-cases/pago_cliente/ListPagoClientesUseCase";
import { CreatePagoClienteSchema, UpdatePagoClienteSchema } from "../../../application/dtos/PagoClienteDTO";
import { ProcessPaymentUseCase } from "../../../application/use-cases/pago_cliente/ProcessPaymentUseCase";
import { PrismaPlanesPagoRepository } from "../../repositories/PrismaPlanesPagoRepository";
import { CreateDetallePagoSchema } from "../../../application/dtos/DetallePagoDTO";
import { z } from "zod";
import {
    PaymentReversalError,
    PaymentReversalService,
} from "../../../application/payment/payment-reversal.service";

const ProcessPaymentSchema = CreatePagoClienteSchema.extend({
    detalles: z.array(CreateDetallePagoSchema.omit({ pago_cliente_id: true })),
    membresia_id: z.string().uuid().optional().nullable(),
});

export class PagoClienteController {
    private createUseCase: CreatePagoClienteUseCase;
    private updateUseCase: UpdatePagoClienteUseCase;
    private getUseCase: GetPagoClienteUseCase;
    private listUseCase: ListUseCase;
    private processUseCase: ProcessPaymentUseCase;
    private reversalService: PaymentReversalService;

    constructor() {
        const repository = new PrismaPagoClienteRepository();
        const planRepo = new PrismaPlanesPagoRepository();
        this.createUseCase = new CreatePagoClienteUseCase(repository);
        this.updateUseCase = new UpdatePagoClienteUseCase(repository);
        this.getUseCase = new GetPagoClienteUseCase(repository);
        this.listUseCase = new ListUseCase(repository);
        this.processUseCase = new ProcessPaymentUseCase(repository, planRepo);
        this.reversalService = new PaymentReversalService();
    }

    // ... existing methods ...

    async create(c: Context) {
        // ... existing create implementation ...
        try {
            const body = await c.req.json();
            const validated = CreatePagoClienteSchema.parse(body);
            const result = await this.createUseCase.execute(validated);

            await prisma.syncLog.create({
                data: {
                    event_id: crypto.randomUUID(),
                    entidad: "pago_cliente",
                    operacion: "INSERT",
                    entidad_id: result.pago_cliente_id,
                    gym_id: result.gym_id,
                    device_id: null,
                    payload_json: JSON.stringify(result),
                },
            });

            return c.json(result, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async process(c: Context) {
        try {
            const body = await c.req.json();
            const auth = c.get("auth");
            const gymId = auth?.gymId;
            if (!gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            const validated = ProcessPaymentSchema.parse({
                ...body,
                gym_id: gymId,
            });
            const result = await this.processUseCase.execute(validated);

            // SyncLog omitted for complexity.

            return c.json(result, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message.includes("not found")) {
                return c.json({ error: error.message }, 404);
            }
            console.error(error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async list(c: Context) {
        try {
            const result = await this.listUseCase.execute();
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async listByClient(c: Context) {
        try {
            const ci = c.req.param("ci");
            const page = Number(c.req.query("page")) || 1;
            const limit = Number(c.req.query("limit")) || 25;
            const pagos = await prisma.pagoCliente.findMany({
                skip: (page - 1) * limit,
                take: limit,
                where: { ci, is_deleted: false },
                orderBy: { fecha: "desc" },
                include: {
                    cliente: {
                        select: {
                            nombres: true,
                            apellidos: true,
                        },
                    },
                    detalles: {
                        where: { is_deleted: false },
                    },
                },
            });
            return c.json(pagos.map((p) => ({
                ...p,
                clientName: `${p.cliente.nombres ?? ""} ${p.cliente.apellidos ?? ""}`.trim(),
                details: p.detalles,
            })));
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getById(c: Context) {
        try {
            const id = c.req.param("id");
            const result = await this.getUseCase.execute(id);
            if (!result) {
                return c.json({ error: "PagoCliente not found" }, 404);
            }
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }



    async update(c: Context) {
        try {
            const id = c.req.param("id");
            const body = await c.req.json();
            const validated = UpdatePagoClienteSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "PagoCliente updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "PagoCliente not found") {
                return c.json({ error: "PagoCliente not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        return this.reverse(c, true);
    }

    async reverse(c: Context, legacy = false) {
        try {
            const auth = c.get("auth");
            if (!auth?.gymId || !auth.sub) {
                return c.json({ error: "El token no identifica usuario y gimnasio." }, 403);
            }
            const body = await c.req.json().catch(() => ({}));
            const result = await this.reversalService.reverse({
                paymentId: c.req.param("id"),
                operationId: String(body.operation_id ?? crypto.randomUUID()),
                reason: String(
                    body.motivo
                    ?? (legacy ? "Anulación desde la ruta compatible anterior" : ""),
                ),
                userId: auth.sub,
                gymId: auth.gymId,
            });
            return c.json(result, result.idempotent ? 200 : 201);
        } catch (error) {
            if (error instanceof PaymentReversalError) {
                return c.json({ error: error.message }, error.status as any);
            }
            console.error(error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
