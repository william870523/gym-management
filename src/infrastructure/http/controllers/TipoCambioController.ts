import type { Context } from "hono";
import { PrismaTipoCambioRepository } from "../../repositories/PrismaTipoCambioRepository";
import { CreateTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/CreateTipoCambioUseCase";
import { UpdateTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/UpdateTipoCambioUseCase";
import { DeleteTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/DeleteTipoCambioUseCase";
import { GetTipoCambioUseCase } from "../../../application/use-cases/tipo_cambio/GetTipoCambioUseCase";
import { ListTipoCambiosUseCase } from "../../../application/use-cases/tipo_cambio/ListTipoCambiosUseCase";
import { CreateTipoCambioSchema, UpdateTipoCambioSchema } from "../../../application/dtos/TipoCambioDTO";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";
import { prisma } from "../../db/prismaClient";
import { trustedClock } from "../../../config/trusted-clock";
import {
    GLOBAL_SURCHARGE_SCOPE,
    readRateSurchargeScope,
    replaceRateSurcharges,
} from "../../../application/payment/rate-surcharge-scope.service";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";
import { randomUUID } from "crypto";

export class TipoCambioController {
    private createUseCase: CreateTipoCambioUseCase;
    private updateUseCase: UpdateTipoCambioUseCase;
    private deleteUseCase: DeleteTipoCambioUseCase;
    private getUseCase: GetTipoCambioUseCase;
    private listUseCase: ListTipoCambiosUseCase;
    private readonly syncLogRepository: PrismaSyncLogRepository;

    constructor() {
        const repository = new PrismaTipoCambioRepository();
        const syncLogRepository = new PrismaSyncLogRepository();
        this.syncLogRepository = syncLogRepository;

        this.createUseCase = new CreateTipoCambioUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateTipoCambioUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteTipoCambioUseCase(repository, syncLogRepository);
        this.getUseCase = new GetTipoCambioUseCase(repository);
        this.listUseCase = new ListTipoCambiosUseCase(repository);
    }

    private auth(c: Context) {
        return c.get("auth") as AuthTokenPayload | undefined;
    }

    private requirePlatform(c: Context) {
        if (this.auth(c)?.esPlataforma === true) return null;
        return c.json({
            error: "Esta acción global es del dueño de la cadena",
            error_code: "PLATFORM_AUTHORITY_REQUIRED",
        }, 403);
    }

    private async present(tipoCambio: any, gymId: string, platform: boolean) {
        const scoped = await readRateSurchargeScope(prisma, tipoCambio, gymId);
        return {
            ...tipoCambio,
            recargos_json: Object.keys(scoped.effective).length
                ? JSON.stringify(scoped.effective)
                : null,
            recargos_globales_json: Object.keys(scoped.global).length
                ? JSON.stringify(scoped.global)
                : null,
            recargos_sede_json: Object.keys(scoped.site).length
                ? JSON.stringify(scoped.site)
                : null,
            recargos_fuentes_json: JSON.stringify(scoped.sources),
            recargos_fuente: scoped.source,
            recargos_gym_id: gymId,
            puede_editar_global: platform,
            puede_editar_sede: true,
        };
    }


    async list(c: Context) {
        try {
            const auth = this.auth(c);
            if (!auth?.gymId) return c.json({ error: "Active gym required" }, 403);
            const result = await this.listUseCase.execute();
            // Convert nested currency images to Base64
            const mappedResult = await Promise.all((result as any[]).map(async tc => ({
                ...await this.present(tc, auth.gymId!, auth.esPlataforma === true),
                moneda_base: tc.moneda_base ? {
                    ...tc.moneda_base,
                    imagen: tc.moneda_base.imagen ? Buffer.from(tc.moneda_base.imagen).toString('base64') : null
                } : null,
                moneda_target: tc.moneda_target ? {
                    ...tc.moneda_target,
                    imagen: tc.moneda_target.imagen ? Buffer.from(tc.moneda_target.imagen).toString('base64') : null
                } : null,
            })));
            return c.json(mappedResult);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getById(c: Context) {
        try {
            const auth = this.auth(c);
            if (!auth?.gymId) return c.json({ error: "Active gym required" }, 403);
            const id = c.req.param("id");
            const result = await this.getUseCase.execute(id);
            if (!result) {
                return c.json({ error: "TipoCambio not found" }, 404);
            }
            const tc = result as any;
            const mappedResult = {
                ...await this.present(tc, auth.gymId, auth.esPlataforma === true),
                moneda_base: tc.moneda_base ? {
                    ...tc.moneda_base,
                    imagen: tc.moneda_base.imagen ? Buffer.from(tc.moneda_base.imagen).toString('base64') : null
                } : null,
                moneda_target: tc.moneda_target ? {
                    ...tc.moneda_target,
                    imagen: tc.moneda_target.imagen ? Buffer.from(tc.moneda_target.imagen).toString('base64') : null
                } : null,
            };
            return c.json(mappedResult);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async create(c: Context) {
        const denied = this.requirePlatform(c);
        if (denied) return denied;
        try {
            const body = await c.req.json();
            const validated = CreateTipoCambioSchema.parse(body);
            const result = await this.createUseCase.execute(validated);
            return c.json(result, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message?.includes("Same-currency")) {
                return c.json({ error: error.message }, 400);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async update(c: Context) {
        const denied = this.requirePlatform(c);
        if (denied) return denied;
        try {
            const id = c.req.param("id");
            const body = await c.req.json();
            const validated = UpdateTipoCambioSchema.parse(body);
            await this.updateUseCase.execute(id, validated);
            return c.json({ message: "TipoCambio updated successfully" });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "TipoCambio not found") {
                return c.json({ error: "TipoCambio not found" }, 404);
            }
            if (error.message?.includes("Same-currency")) {
                return c.json({ error: error.message }, 400);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async delete(c: Context) {
        const denied = this.requirePlatform(c);
        if (denied) return denied;
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ message: "TipoCambio deleted successfully" });
        } catch (error: any) {
            if (error.message === "TipoCambio not found") {
                return c.json({ error: "TipoCambio not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async replaceSiteSurcharges(c: Context) {
        const auth = this.auth(c);
        if (!auth?.gymId || !auth.sub) return c.json({ error: "Active gym required" }, 403);
        return this.replaceSurcharges(c, auth.gymId, auth.gymId, auth.sub);
    }

    async resetSiteSurcharges(c: Context) {
        return this.replaceSiteSurcharges(c);
    }

    async replaceGlobalSurcharges(c: Context) {
        const denied = this.requirePlatform(c);
        if (denied) return denied;
        const auth = this.auth(c);
        if (!auth?.gymId || !auth.sub) return c.json({ error: "Active gym required" }, 403);
        return this.replaceSurcharges(c, GLOBAL_SURCHARGE_SCOPE, null, auth.sub);
    }

    private async replaceSurcharges(
        c: Context,
        scope: string,
        eventGymId: string | null,
        actorUserId: string,
    ) {
        const rateId = c.req.param("id");
        try {
            const body = c.req.method === "DELETE"
                ? { recargos: {} }
                : await c.req.json();
            const nowUtc = trustedClock.nowUtc();
            await prisma.$transaction(async (tx) => {
                const result = await replaceRateSurcharges({
                    tx,
                    rateId,
                    scope,
                    values: body.recargos,
                    sourceDevice: "WEB_ADMIN",
                    nowUtc,
                });
                for (const change of result.changed) {
                    await this.syncLogRepository.register({
                        eventId: randomUUID(),
                        entidad: "tipo_cambio_recargo",
                        operacion: change.operation,
                        entidadId: change.row.tipo_cambio_recargo_id,
                        gymId: eventGymId,
                        deviceId: "WEB_ADMIN",
                        payload: change.row,
                    }, tx);
                }

                if (scope === GLOBAL_SURCHARGE_SCOPE) {
                    const mirror = Object.keys(result.values).length
                        ? JSON.stringify(result.values)
                        : null;
                    if (result.rate.recargos_json !== mirror) {
                        const updated = await tx.tipoCambio.update({
                            where: { tipo_cambio_id: rateId },
                            data: {
                                recargos_json: mirror,
                                updated_at: nowUtc,
                                version: { increment: 1 },
                            },
                        });
                        await this.syncLogRepository.register({
                            eventId: randomUUID(),
                            entidad: "tipo_cambio",
                            operacion: "UPDATE",
                            entidadId: rateId,
                            gymId: null,
                            deviceId: "WEB_ADMIN",
                            payload: updated,
                        }, tx);
                    }
                }
            });
            const rate = await prisma.tipoCambio.findUnique({
                where: { tipo_cambio_id: rateId },
                include: { moneda_base: true, moneda_target: true },
            });
            if (!rate || rate.is_deleted) return c.json({ error: "TipoCambio not found" }, 404);
            const auth = this.auth(c)!;
            return c.json(await this.present(rate, auth.gymId!, auth.esPlataforma === true));
        } catch (error: any) {
            const status = error.message === "TipoCambio not found" ? 404 : 400;
            return c.json({ error: error.message ?? "No se pudieron guardar los recargos." }, status);
        }
    }
}
