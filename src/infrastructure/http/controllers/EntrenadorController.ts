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
import {
    TrainerOffboardingService,
    asTrainerOffboardingError,
} from "../../../application/trainer/trainer-offboarding.service";
import {
    TrainerOffboardingCaseService,
    asTrainerOffboardingCaseError,
} from "../../../application/trainer/trainer-offboarding-case.service";
import { TrainerOffboardingExecutionService } from "../../../application/trainer/trainer-offboarding-execution.service";
import {
    TrainerOffboardingFinancialService,
    asTrainerOffboardingFinancialError,
} from "../../../application/trainer/trainer-offboarding-financial.service";
import {
    TrainerSettlementService,
    asTrainerSettlementError,
} from "../../../application/accounting/trainer-settlement.service";

export class EntrenadorController {
    private createUseCase: CreateEntrenadorUseCase;
    private updateUseCase: UpdateEntrenadorUseCase;
    private deleteUseCase: DeleteEntrenadorUseCase;
    private getUseCase: GetEntrenadorUseCase;
    private listUseCase: ListEntrenadoresUseCase;
    private offboardingService: TrainerOffboardingService;
    private offboardingCaseService: TrainerOffboardingCaseService;
    private offboardingExecutionService: TrainerOffboardingExecutionService;
    private offboardingFinancialService: TrainerOffboardingFinancialService;
    private trainerSettlementService: TrainerSettlementService;

    constructor() {
        const repository = new PrismaEntrenadorRepository();
        const syncLogRepository = new PrismaSyncLogRepository();

        this.createUseCase = new CreateEntrenadorUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateEntrenadorUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteEntrenadorUseCase(repository, syncLogRepository);
        this.getUseCase = new GetEntrenadorUseCase(repository);
        this.listUseCase = new ListEntrenadoresUseCase(repository);
        this.offboardingService = new TrainerOffboardingService();
        this.offboardingCaseService = new TrainerOffboardingCaseService();
        this.offboardingExecutionService = new TrainerOffboardingExecutionService();
        this.offboardingFinancialService = new TrainerOffboardingFinancialService();
        this.trainerSettlementService = new TrainerSettlementService();
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

    async offboardingImpact(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId) {
            return c.json({ error: "El token no identifica un gimnasio." }, 403);
        }
        try {
            return c.json(await this.offboardingService.impact(auth.gymId, c.req.param("id")));
        } catch (error) {
            const known = asTrainerOffboardingError(error);
            if (known) {
                return c.json(
                    { error: known.message, impact: known.details ?? null },
                    known.status as any,
                );
            }
            logger.error("Error analyzing trainer offboarding:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getOpenOffboardingCase(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            const result = await this.offboardingCaseService.getOpen(auth.gymId, c.req.param("id"));
            return result ? c.json(serialize(result)) : c.json({ data: null });
        } catch (error) {
            const known = asTrainerOffboardingCaseError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error reading trainer offboarding case:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async createOffboardingCase(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            const body = await c.req.json();
            const result = await this.offboardingCaseService.create({
                gymId: auth.gymId,
                trainerId: c.req.param("id"),
                effectiveDate: body.fecha_efectiva,
                reason: body.motivo,
                userId: auth.sub,
            });
            return c.json(serialize(result), result.idempotent ? 200 : 201);
        } catch (error) {
            const known = asTrainerOffboardingCaseError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error creating trainer offboarding case:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async updateOffboardingDecision(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            const body = await c.req.json();
            return c.json(serialize(await this.offboardingCaseService.updateDecision({
                gymId: auth.gymId,
                trainerId: c.req.param("id"),
                caseId: c.req.param("caseId"),
                membershipId: c.req.param("membershipId"),
                operationId: String(body.operation_id ?? ""),
                userId: auth.sub,
                decision: body,
            })));
        } catch (error) {
            const known = asTrainerOffboardingCaseError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error updating trainer offboarding decision:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async executeOffboardingCase(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            const body = await c.req.json();
            return c.json(serialize(await this.offboardingExecutionService.execute({
                gymId: auth.gymId,
                trainerId: c.req.param("id"),
                caseId: c.req.param("caseId"),
                operationId: String(body.operation_id ?? ""),
                userId: auth.sub,
            })));
        } catch (error) {
            const known = asTrainerOffboardingCaseError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error executing trainer offboarding case:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async previewOffboardingFinancial(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            return c.json(serialize(await this.offboardingFinancialService.preview({
                gymId: auth.gymId,
                trainerId: c.req.param("id"),
                caseId: c.req.param("caseId"),
                membershipId: c.req.param("membershipId"),
                type: c.req.query("tipo"),
                destinationPlanId: c.req.query("plan_destino_id"),
            })));
        } catch (error) {
            const known = asTrainerOffboardingFinancialError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error previewing trainer offboarding financial resolution:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async resolveOffboardingFinancial(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            const body = await c.req.json();
            return c.json(serialize(await this.offboardingFinancialService.resolve({
                gymId: auth.gymId,
                trainerId: c.req.param("id"),
                caseId: c.req.param("caseId"),
                membershipId: c.req.param("membershipId"),
                operationId: String(body.operation_id ?? ""),
                userId: auth.sub,
                type: body.tipo,
                destinationPlanId: body.plan_destino_id,
                targetTrainerId: body.id_entrenador_destino,
                reason: body.motivo,
            })));
        } catch (error) {
            const known = asTrainerOffboardingFinancialError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error resolving trainer offboarding financial resolution:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async previewFinalOffboardingSettlement(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            return c.json(serialize(await this.trainerSettlementService.finalOffboardingPreview(
                auth.gymId,
                c.req.param("id"),
                c.req.param("caseId"),
            )));
        } catch (error) {
            const known = asTrainerSettlementError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error previewing final offboarding settlement:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async createFinalOffboardingSettlement(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            const body = await c.req.json();
            const liquidacion = await this.trainerSettlementService.createFinalOffboarding({
                gymId: auth.gymId,
                trainerId: c.req.param("id"),
                caseId: c.req.param("caseId"),
                currencyId: String(body.moneda_id ?? ""),
                operationId: String(body.operacion_id ?? ""),
                accountId: String(body.cuenta_id ?? ""),
                paymentTypeId: String(body.tipo_pago_id ?? ""),
                notes: body.notas,
                userId: auth.sub,
            });
            return c.json(serialize({
                liquidacion,
                expediente: await this.offboardingCaseService.getById(
                    auth.gymId,
                    c.req.param("id"),
                    c.req.param("caseId"),
                ),
                resumen_final: await this.trainerSettlementService.finalOffboardingPreview(
                    auth.gymId,
                    c.req.param("id"),
                    c.req.param("caseId"),
                ),
            }), 201);
        } catch (error) {
            const known = asTrainerSettlementError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error creating final offboarding settlement:", error);
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async closeFinalOffboardingSettlement(c: Context) {
        const auth = c.get("auth");
        if (!auth?.gymId || !auth?.sub) {
            return c.json({ error: "El token no identifica una cuenta y gimnasio." }, 403);
        }
        try {
            const body = await c.req.json();
            await this.trainerSettlementService.closeFinalOffboarding({
                gymId: auth.gymId,
                trainerId: c.req.param("id"),
                caseId: c.req.param("caseId"),
                operationId: String(body.operacion_id ?? ""),
                userId: auth.sub,
            });
            return c.json(serialize({
                liquidacion: null,
                expediente: await this.offboardingCaseService.getById(
                    auth.gymId,
                    c.req.param("id"),
                    c.req.param("caseId"),
                ),
                resumen_final: await this.trainerSettlementService.finalOffboardingPreview(
                    auth.gymId,
                    c.req.param("id"),
                    c.req.param("caseId"),
                ),
            }));
        } catch (error) {
            const known = asTrainerSettlementError(error);
            if (known) return c.json({ error: known.message }, known.status as any);
            logger.error("Error closing final offboarding settlement:", error);
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
            const auth = c.get("auth");
            if (!auth?.gymId) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            await this.offboardingService.assertDirectDeletionAllowed(auth.gymId, id);
            await this.deleteUseCase.execute(id);
            return c.json({ message: "Entrenador deleted successfully" });
        } catch (error: any) {
            const known = asTrainerOffboardingError(error);
            if (known) {
                return c.json(
                    { error: known.message, impact: known.details ?? null },
                    known.status as any,
                );
            }
            if (error.message === "Entrenador not found") {
                return c.json({ error: "Entrenador not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
