import type { Context } from "hono";
import {
    DropoutReasonService,
    ReglaMotivoBaja,
} from "../../../application/retention/dropout-reason.service";

/**
 * Catálogo de motivos de baja en la API remota (PLAN_ESTADISTICAS.md §7-ter).
 * El ámbito sale del token: un administrador solo ve y edita los motivos de su
 * sede.
 */
export class MotivoBajaController {
    private readonly service = new DropoutReasonService();

    async list(c: Context) {
        const gymId = this.gymId(c);
        if (!gymId) return c.json({ error: "Gym scope required" }, 403);
        try {
            const soloActivos = c.req.query("activos") === "true";
            return c.json(await this.service.list(gymId, soloActivos));
        } catch (error) {
            return this.fallo(c, error);
        }
    }

    async getById(c: Context) {
        const gymId = this.gymId(c);
        if (!gymId) return c.json({ error: "Gym scope required" }, 403);
        try {
            const motivo = await this.service.getById(gymId, c.req.param("id"));
            if (!motivo) return c.json({ error: "Motivo de baja no encontrado" }, 404);
            return c.json(motivo);
        } catch (error) {
            return this.fallo(c, error);
        }
    }

    async create(c: Context) {
        const gymId = this.gymId(c);
        if (!gymId) return c.json({ error: "Gym scope required" }, 403);
        try {
            return c.json(await this.service.create(gymId, await c.req.json()), 201);
        } catch (error) {
            return this.fallo(c, error);
        }
    }

    async update(c: Context) {
        const gymId = this.gymId(c);
        if (!gymId) return c.json({ error: "Gym scope required" }, 403);
        try {
            return c.json(
                await this.service.update(gymId, c.req.param("id"), await c.req.json()),
            );
        } catch (error) {
            return this.fallo(c, error);
        }
    }

    async delete(c: Context) {
        const gymId = this.gymId(c);
        if (!gymId) return c.json({ error: "Gym scope required" }, 403);
        try {
            return c.json(await this.service.remove(gymId, c.req.param("id")));
        } catch (error) {
            return this.fallo(c, error);
        }
    }

    private fallo(c: Context, error: unknown) {
        if (error instanceof ReglaMotivoBaja) {
            return c.json({ error: error.message }, error.status);
        }
        console.error("Error en motivos de baja:", error);
        return c.json({ error: "Internal Server Error" }, 500);
    }

    private gymId(c: Context): string | null {
        const auth = c.get("auth");
        return auth?.gymId?.trim() || null;
    }
}
