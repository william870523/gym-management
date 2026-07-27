import { describe, expect, it } from "bun:test";
import { createGym, deleteGym, getGymById, updateGym } from "./gyms.controller";

function context(gymId: string, targetId = gymId) {
    return {
        get(key: string) {
            return key === "auth"
                ? { sub: "admin-a", role: "admin", gymId }
                : undefined;
        },
        req: {
            param() {
                return targetId;
            },
            async json() {
                return { nombre: "Ataque", gym_id: targetId };
            },
        },
        json(body: unknown, status?: number) {
            return { body, status: status ?? 200 };
        },
    } as any;
}

describe("autoridad de sede en /gyms", () => {
    it("oculta otra sede antes de consultar o mutar Prisma", async () => {
        const read = await getGymById(context("gym-a", "gym-b"));
        const update = await updateGym(context("gym-a", "gym-b"));
        expect(read.status).toBe(404);
        expect(update.status).toBe(404);
    });

    it("bloquea alta y baja sin una autoridad de plataforma inventada", async () => {
        const create = await createGym(context("gym-a"));
        const remove = await deleteGym(context("gym-a"));
        expect(create.status).toBe(403);
        expect(remove.status).toBe(403);
        expect(create.body).toMatchObject({ error_code: "PLATFORM_AUTHORITY_REQUIRED" });
        expect(remove.body).toMatchObject({ error_code: "PLATFORM_AUTHORITY_REQUIRED" });
    });
});
