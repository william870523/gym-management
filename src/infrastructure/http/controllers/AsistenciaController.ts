import type { Context } from "hono";
import { PrismaAsistenciaRepository } from "../../repositories/PrismaAsistenciaRepository";
import { prisma } from "../../db/prismaClient";
import * as crypto from "crypto";
import { CreateAsistenciaUseCase } from "../../../application/use-cases/asistencia/CreateAsistenciaUseCase";
import { UpdateAsistenciaUseCase } from "../../../application/use-cases/asistencia/UpdateAsistenciaUseCase";
import { DeleteAsistenciaUseCase } from "../../../application/use-cases/asistencia/DeleteAsistenciaUseCase";
import { GetAsistenciaUseCase } from "../../../application/use-cases/asistencia/GetAsistenciaUseCase";
import { ListAsistenciasUseCase } from "../../../application/use-cases/asistencia/ListAsistenciasUseCase";
import { CreateAsistenciaSchema, UpdateAsistenciaSchema } from "../../../application/dtos/AsistenciaDTO";
import { getUserGymActor } from "../middleware/auth.middleware";
import { AsistenciaElegibilidadService } from "../../../application/asistencia/asistencia-elegibilidad.service";
import {
    AsistenciaPermanenciaError,
    AsistenciaPermanenciaService,
} from "../../../application/asistencia/asistencia-permanencia.service";

export class AsistenciaController {
    private updateUseCase: UpdateAsistenciaUseCase;
    private deleteUseCase: DeleteAsistenciaUseCase;
    private getUseCase: GetAsistenciaUseCase;
    private listUseCase: ListAsistenciasUseCase;
    private permanenciaService = new AsistenciaPermanenciaService();

    constructor() {
        const repository = new PrismaAsistenciaRepository();
        this.updateUseCase = new UpdateAsistenciaUseCase(repository);
        this.deleteUseCase = new DeleteAsistenciaUseCase(repository);
        this.getUseCase = new GetAsistenciaUseCase(repository);
        this.listUseCase = new ListAsistenciasUseCase(repository);
    }

    async list(c: Context) {
        try {
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const page = Math.max(1, Math.trunc(Number(c.req.query("page")) || 1));
            const limit = Math.min(
                Math.max(1, Math.trunc(Number(c.req.query("limit")) || 10)),
                200,
            );
            const ci = c.req.param("ci") || c.req.query("ci");
            const date = c.req.query("date")?.trim() || undefined;
            if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return c.json({ error: "La fecha debe usar el formato YYYY-MM-DD" }, 400);
            }
            const result = await this.listUseCase.execute(
                actor.gymId,
                page,
                limit,
                ci,
                date,
            );
            return c.json(result);
        } catch (error) {
            if (String((error as Error)?.message ?? "").includes("fecha")) {
                return c.json({ error: (error as Error).message }, 400);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async listActive(c: Context) {
        try {
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const page = Number(c.req.query("page")) || 1;
            const limit = Math.min(Number(c.req.query("limit")) || 100, 200);
            const skip = (page - 1) * limit;
            const result = await new PrismaAsistenciaRepository().findActive(actor.gymId, skip, limit);
            return c.json(result);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async listToday(c: Context) {
        try {
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const result = await new PrismaAsistenciaRepository().findToday(actor.gymId);
            return c.json(result);
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
            const actor = getUserGymActor(c);
            if (!actor) {
                return c.json({ error: "El token no identifica un gimnasio." }, 403);
            }
            const gymId = actor.gymId;

            // La regla de quién puede entrar estaba aquí, a medias y con otra
            // redacción que la del escritorio: comprobaba pausa y pago
            // pendiente, pero no la cuota vencida ni la entrada repetida. Ahora
            // vive entera en la política de dominio gemela y la aplica el caso
            // de uso, que es lo que garantiza que las dos superficies digan y
            // hagan lo mismo.
            //
            // El gimnasio proviene del JWT; nunca se acepta el gym_id libre
            // que pueda enviar el cliente HTTP.
            const { asistencia: result, creada } = await prisma.$transaction(async (tx) => {
                const useCase = new CreateAsistenciaUseCase(
                    new PrismaAsistenciaRepository(tx),
                    new AsistenciaElegibilidadService(tx),
                );
                const response = await useCase.execute(validated, gymId);

                // Repetir la entrada de quien ya está dentro devuelve su misma
                // fila y NO vuelve a encolar. Alta y evento comparten tx.
                if (response.creada) {
                    await tx.syncLog.create({
                        data: {
                            event_id: crypto.randomUUID(),
                            entidad: "asistencia",
                            operacion: "INSERT",
                            entidad_id: response.asistencia.asistencia_id,
                            gym_id: response.asistencia.gym_id,
                            device_id: null,
                            payload_json: JSON.stringify(response.asistencia),
                        },
                    });
                }
                return response;
            });

            return c.json(result, creada ? 201 : 200);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (String(error.message).includes("no pertenece al gimnasio")) {
                return c.json({ error: error.message }, 400);
            }
            // Rechazo de negocio, no avería: pausa, pago pendiente o mora.
            // Devolverlo como 500 haría que el mostrador leyera «falló el
            // sistema» donde el sistema está funcionando bien.
            if (error?.status === 409) {
                return c.json({ error: error.message }, 409);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async finalize(c: Context) {
        try {
            const id = c.req.param("id");
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.permanenciaService.finalize(actor.gymId, id);
            return c.json(result);
        } catch (error: any) {
            if (error instanceof AsistenciaPermanenciaError) {
                return c.json({ error: error.message }, error.status);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async pause(c: Context) {
        try {
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.permanenciaService.pause(
                actor.gymId,
                c.req.param("id"),
            );
            return c.json(result);
        } catch (error: any) {
            if (error instanceof AsistenciaPermanenciaError) {
                return c.json({ error: error.message }, error.status);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async resume(c: Context) {
        try {
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.permanenciaService.resume(
                actor.gymId,
                c.req.param("id"),
            );
            return c.json(result);
        } catch (error: any) {
            if (error instanceof AsistenciaPermanenciaError) {
                return c.json({ error: error.message }, error.status);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async update(c: Context) {
        try {
            const id = c.req.param("id");
            const body = await c.req.json();
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            const validated = UpdateAsistenciaSchema.parse(body);
            await this.updateUseCase.execute(id, validated, actor.gymId);
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
            const actor = getUserGymActor(c);
            if (!actor) return c.json({ error: "Gym scope required" }, 403);
            await this.deleteUseCase.execute(id, actor.gymId);
            return c.json({ message: "Asistencia deleted successfully" });
        } catch (error: any) {
            if (error.message === "Asistencia not found") {
                return c.json({ error: "Asistencia not found" }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
