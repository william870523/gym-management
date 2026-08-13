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
import { PrismaClienteRepository } from "../../repositories/PrismaClienteRepository";
import { RecargoMoraQuoteService } from "../../../application/payment/recargo-mora-quote.service";
import { CreateDetallePagoSchema } from "../../../application/dtos/DetallePagoDTO";
import { z } from "zod";
import {
    PaymentReversalError,
    PaymentReversalService,
} from "../../../application/payment/payment-reversal.service";
import { getUserGymActor } from "../middleware/auth.middleware";
import { PaymentRuleError } from "../../../domain/payment-rule-error";
import { PaymentActorError } from "../../../application/payment/payment-actor";
import {
    MethodSurchargeError,
    quoteMethodSurcharge,
} from "../../../application/payment/method-surcharge.service";
import { trustedClock } from "../../../config/trusted-clock";
import { ClientDiscountQuoteService } from "../../../application/payment/client-discount-quote.service";

const ProcessPaymentSchema = CreatePagoClienteSchema.extend({
    detalles: z.array(CreateDetallePagoSchema.omit({ pago_cliente_id: true })),
    membresia_id: z.string().uuid().optional().nullable(),
    // Recargo por mora: se aplica siempre que corresponda. Condonarlo exige
    // motivo y deja rastro (docs/RECARGO_MORA.md §6-bis).
    condonar_recargo_mora: z.boolean().optional(),
    motivo_condonacion_recargo: z.string().trim().min(5).max(500).optional(),
    // R5.2 — cobro por cuotas (docs/PLAN_INSTALLMENTS.md).
    modo_cuotas: z.boolean().optional(),
    numero_cuota: z.number().int().positive().optional().nullable(),
}).superRefine((value, ctx) => {
    // Reglas discriminadas: el modo completo no admite número de cuota, y
    // pagar una cuota distinta de la 1 exige decir de qué membresía es.
    if (!value.modo_cuotas && value.numero_cuota != null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["numero_cuota"],
            message: "El cobro completo no admite número de cuota.",
        });
    }
    if (value.modo_cuotas && (value.numero_cuota ?? 1) > 1 && !value.membresia_id) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["membresia_id"],
            message: "Pagar una cuota siguiente exige indicar la membresía.",
        });
    }
});

export class PagoClienteController {
    private createUseCase: CreatePagoClienteUseCase;
    private updateUseCase: UpdatePagoClienteUseCase;
    private getUseCase: GetPagoClienteUseCase;
    private listUseCase: ListUseCase;
    private processUseCase: ProcessPaymentUseCase;
    private recargoMoraQuotes: RecargoMoraQuoteService;
    private reversalService: PaymentReversalService;
    private clientDiscountQuotes: ClientDiscountQuoteService;

    constructor() {
        const repository = new PrismaPagoClienteRepository();
        const planRepo = new PrismaPlanesPagoRepository();
        this.createUseCase = new CreatePagoClienteUseCase(repository);
        this.updateUseCase = new UpdatePagoClienteUseCase(repository);
        this.getUseCase = new GetPagoClienteUseCase(repository);
        this.listUseCase = new ListUseCase(repository);
        // El repositorio de clientes permite medir el atraso para el recargo
        // por mora (docs/RECARGO_MORA.md).
        this.processUseCase = new ProcessPaymentUseCase(
            repository,
            planRepo,
            new PrismaClienteRepository(),
        );
        this.reversalService = new PaymentReversalService();
        this.recargoMoraQuotes = new RecargoMoraQuoteService();
        this.clientDiscountQuotes = new ClientDiscountQuoteService();
    }

    // ... existing methods ...

    // `create` se retiró el 12-08-2026. Su ruta responde 410 desde antes
    // (`paymentWriteGone`), así que el método estaba muerto; y además escribía
    // la fila y su evento por separado, sin transacción. Un cobro no atómico
    // esperando a que alguien volviera a enrutarlo es exactamente lo que el
    // comentario de ese guarda dice querer evitar. Para crear un cobro:
    // `POST /pagos/process`.

    /**
     * Cotización autoritativa del recargo por mora (docs/RECARGO_MORA.md).
     * Solo lectura; el gimnasio sale del token.
     */
    async recargoMoraQuote(c: Context) {
        try {
            const auth = c.get("auth");
            const gymId = auth?.gymId;
            if (!gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            const quote = await this.recargoMoraQuotes.quote({
                ci: c.req.query("ci") ?? "",
                planId: c.req.query("plan_id") ?? "",
                membresiaId: c.req.query("membresia_id") ?? null,
                numeroCuota: c.req.query("numero_cuota")
                    ? Number(c.req.query("numero_cuota"))
                    : null,
                aplicar: c.req.query("aplicar") !== "false",
            }, gymId);
            return c.json(quote);
        } catch (error: any) {
            return c.json({ error: error.message }, 400);
        }
    }

    async descuentoClienteQuote(c: Context) {
        try {
            const auth = c.get("auth");
            if (!auth?.gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            return c.json(await this.clientDiscountQuotes.quote({
                gymId: auth.gymId,
                ci: c.req.query("ci") ?? "",
                planId: c.req.query("plan_id") ?? "",
                numeroCuota: c.req.query("numero_cuota")
                    ? Number(c.req.query("numero_cuota"))
                    : null,
            }));
        } catch (error: any) {
            return c.json({ error: error.message }, 400);
        }
    }

    async recargoMetodoQuote(c: Context) {
        try {
            const auth = c.get("auth");
            if (!auth?.gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            const body = await c.req.json();
            const quote = await quoteMethodSurcharge(prisma, {
                receivedAmount: body.total_recibido,
                paymentTypeId: body.tipo_pago_id,
                accountId: body.cuenta_id,
                paymentCurrencyId: body.moneda_pago_id,
                planCurrencyId: body.moneda_plan_id,
                exchangeRateId: body.tipo_cambio_id ?? null,
            }, auth.gymId, trustedClock.nowUtc());
            return c.json(quote);
        } catch (error: any) {
            const status = error instanceof MethodSurchargeError ? error.status : 400;
            return c.json({ error: error.message }, status as any);
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
            const validated = ProcessPaymentSchema.parse(body);
            // El actor sale del token, nunca del cuerpo.
            const actor = getUserGymActor(c);
            const result = await this.processUseCase.execute(
                validated, gymId, actor?.userId ?? null,
            );

            // SyncLog omitted for complexity.

            return c.json(result, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                // Zod 4 expone `issues`; con `errors` la respuesta salía como
                // `{}` y la web solo podía decir «el servidor rechazó el pago».
                const issues = (error.issues ?? []) as Array<{ path: unknown[]; message: string }>;
                const detalle = issues
                    .map((i) => `${i.path.join(".") || "(cuerpo)"}: ${i.message}`)
                    .join("; ");
                return c.json({ error: detalle || "Datos del cobro inválidos.", issues }, 400);
            }
            // R5.6: sin cobrador válido no se cobra, y el motivo importa:
            // 401 sesión ausente, 403 cuenta ajena o inactiva, 503 identidad
            // no comprobable. Nunca se completa con datos del cuerpo.
            if (error instanceof PaymentActorError) {
                return c.json({ error: error.message }, error.status as any);
            }
            if (error instanceof MethodSurchargeError) {
                return c.json({ error: error.message }, error.status as any);
            }
            // Regla de negocio incumplida: el operador debe leer el motivo.
            if (error instanceof PaymentRuleError) {
                return c.json({ error: error.message }, 400);
            }
            if (error.message?.includes("not found")) {
                return c.json({ error: error.message }, 404);
            }
            console.error(error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async list(c: Context) {
        try {
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const page = Math.max(1, Number(c.req.query("page")) || 1);
            const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 10));
            const skip = (page - 1) * limit;
            const [data, total, totalVoided] = await Promise.all([
                this.listUseCase.execute(actor.gymId, skip, limit),
                prisma.pagoCliente.count({ where: { gym_id: actor.gymId } }),
                prisma.pagoCliente.count({
                    where: { gym_id: actor.gymId, is_deleted: true },
                }),
            ]);
            return c.json({ data, total, totalVoided });
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async listByClient(c: Context) {
        try {
            const ci = c.req.param("ci");
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const page = Number(c.req.query("page")) || 1;
            const limit = Number(c.req.query("limit")) || 25;
            const pagos = await prisma.pagoCliente.findMany({
                skip: (page - 1) * limit,
                take: limit,
                where: { ci, gym_id: actor.gymId, is_deleted: false },
                orderBy: { fecha: "desc" },
                include: {
                    cliente: {
                        select: {
                            nombres: true,
                            apellidos: true,
                        },
                    },
                    detalles: {
                        where: { gym_id: actor.gymId, is_deleted: false },
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
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.getUseCase.execute(id, actor.gymId);
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
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const validated = UpdatePagoClienteSchema.parse(body);
            await this.updateUseCase.execute(id, validated, actor.gymId);
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
