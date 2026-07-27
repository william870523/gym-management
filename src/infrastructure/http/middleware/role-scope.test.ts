/**
 * Alcance por puesto en la web (docs/REMOTE_ROLE_SCOPE.md).
 *
 * La web es la aplicación completa: recepción tiene que poder trabajar en el
 * navegador si su escritorio falla. Estas pruebas fijan hasta dónde llega cada
 * puesto y, sobre todo, que la autoridad sale del rol PERSISTIDO y no del que
 * traiga el token.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { JwtService } from "../../auth/jwt.service";
import {
    authUser,
    normalizeStaffRole,
    requireAdmin,
    requireAdminForWrites,
    requireStaff,
} from "./auth.middleware";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const noAudit = async () => {};
const tokenFor = (role: string, userId = "operador-a") =>
    JwtService.signAdminToken({ userId, role, gymId: "gym-a" });

/** App mínima: sesión revalidada con el rol que diga la base + un guardián. */
const appWith = (persistedRole: string, guard: ReturnType<typeof requireStaff>) => {
    const app = new Hono();
    app.use("*", authUser(async () => ({ role: persistedRole }), noAudit));
    app.use("*", guard);
    app.get("/", (c) => c.json({ ok: true }));
    app.post("/", (c) => c.json({ ok: true }));
    app.delete("/", (c) => c.json({ ok: true }));
    return app;
};

describe("normalización de puestos", () => {
    it("reconoce las variantes que existen en la base", () => {
        expect(normalizeStaffRole("admin")).toBe("admin");
        expect(normalizeStaffRole("Administrador")).toBe("admin");
        expect(normalizeStaffRole("reception")).toBe("reception");
        // La base remota tiene una cuenta con este valor histórico.
        expect(normalizeStaffRole("recepcionista")).toBe("reception");
        expect(normalizeStaffRole("  RECEPCIÓN ")).toBe("reception");
    });

    it("no inventa personal: lo desconocido no es un puesto", () => {
        expect(normalizeStaffRole("user")).toBeNull();
        expect(normalizeStaffRole("trainer")).toBeNull();
        expect(normalizeStaffRole("")).toBeNull();
        expect(normalizeStaffRole(undefined)).toBeNull();
    });
});

describe("requireStaff", () => {
    it("deja pasar a recepción", async () => {
        const response = await appWith("reception", requireStaff(noAudit))
            .request("/", { headers: bearer(tokenFor("reception")) });
        expect(response.status).toBe(200);
    });

    it("cierra la puerta a un rol que no es de personal", async () => {
        const response = await appWith("user", requireStaff(noAudit))
            .request("/", { headers: bearer(tokenFor("user")) });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: "Forbidden - Staff role required",
        });
    });
});

describe("requireAdmin", () => {
    it("acepta administración", async () => {
        const response = await appWith("admin", requireAdmin(noAudit))
            .request("/", { headers: bearer(tokenFor("admin")) });
        expect(response.status).toBe(200);
    });

    it("niega a recepción lo que es de administración", async () => {
        const response = await appWith("reception", requireAdmin(noAudit))
            .request("/", { headers: bearer(tokenFor("reception")) });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: "Forbidden - Administration role required",
        });
    });

    it("manda el puesto guardado, no el que venga en el token", async () => {
        // Token que se declara admin sobre una cuenta que en la base es de
        // recepción: si esto pasara, bastaría firmar un claim para anular cobros.
        const response = await appWith("reception", requireAdmin(noAudit))
            .request("/", { headers: bearer(tokenFor("admin", "recepcion-con-claim-viejo")) });
        expect(response.status).toBe(403);
    });
});

describe("requireAdminForWrites", () => {
    it("recepción consulta el catálogo", async () => {
        const response = await appWith("reception", requireAdminForWrites(noAudit))
            .request("/", { headers: bearer(tokenFor("reception")) });
        expect(response.status).toBe(200);
    });

    it("recepción no lo modifica ni lo borra", async () => {
        const app = appWith("reception", requireAdminForWrites(noAudit));
        const headers = bearer(tokenFor("reception"));
        const created = await app.request("/", { method: "POST", headers });
        const removed = await app.request("/", { method: "DELETE", headers });
        expect(created.status).toBe(403);
        expect(removed.status).toBe(403);
        expect(await created.json()).toEqual({
            error: "Forbidden - Administration role required to modify this catalogue",
        });
    });

    it("administración sí lo modifica", async () => {
        const response = await appWith("admin", requireAdminForWrites(noAudit))
            .request("/", { method: "POST", headers: bearer(tokenFor("admin")) });
        expect(response.status).toBe(200);
    });
});
