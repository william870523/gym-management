import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { JwtService } from "../../auth/jwt.service";
import { authAdmin, authUser, requirePermission } from "./auth.middleware";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const noAudit = async () => {};

describe("revalidación administrativa", () => {
    it("acepta solo la cuenta admin activa del gimnasio firmado", async () => {
        const calls: unknown[] = [];
        const app = new Hono();
        app.use("*", authAdmin(async (input) => {
            calls.push(input);
            return true;
        }, noAudit));
        app.get("/", (c) => c.json(c.get("auth")));

        const token = JwtService.signAdminToken({
            userId: "admin-a",
            role: "admin",
            gymId: "gym-a",
        });
        const response = await app.request("/", { headers: bearer(token) });

        expect(response.status).toBe(200);
        expect(calls).toEqual([{ userId: "admin-a", gymId: "gym-a" }]);
        expect(await response.json()).toMatchObject({
            sub: "admin-a",
            role: "admin",
            gymId: "gym-a",
        });
    });

    it("revoca un JWT válido cuando la cuenta o la sede ya no están activas", async () => {
        const app = new Hono();
        app.use("*", authAdmin(async () => false, noAudit));
        app.get("/", (c) => c.json({ ok: true }));
        const token = JwtService.signAdminToken({
            userId: "admin-revocado",
            role: "admin",
            gymId: "gym-a",
        });

        const response = await app.request("/", { headers: bearer(token) });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            error: "Forbidden - Admin account is inactive or out of scope",
        });
    });

    it("rechaza claims sin gimnasio o de dispositivo antes de consultar DB", async () => {
        let calls = 0;
        const app = new Hono();
        app.use("*", authAdmin(async () => {
            calls += 1;
            return true;
        }, noAudit));
        app.get("/", (c) => c.json({ ok: true }));

        const noGym = JwtService.signAdminToken({
            userId: "admin-sin-sede",
            role: "admin",
        });
        const device = JwtService.signDeviceToken({
            deviceId: "device-a",
            role: "device",
            gymId: "gym-a",
        });

        expect((await app.request("/", { headers: bearer(noGym) })).status).toBe(403);
        expect((await app.request("/", { headers: bearer(device) })).status).toBe(403);
        expect(calls).toBe(0);
    });

    it("requirePermission falla cerrado mientras RBAC no tenga política real", async () => {
        const app = new Hono();
        app.use("*", requirePermission("clients.read", noAudit));
        app.get("/", (c) => c.json({ ok: true }));

        const response = await app.request("/");
        expect(response.status).toBe(403);
    });
});

describe("revalidación de operadores", () => {
    it("revoca cuentas inactivas aunque el JWT siga siendo válido", async () => {
        const app = new Hono();
        app.use("*", authUser(async () => null, noAudit));
        app.get("/", (c) => c.json({ ok: true }));
        const token = JwtService.signAdminToken({
            userId: "operador-revocado",
            role: "user",
            gymId: "gym-a",
        });

        expect((await app.request("/", { headers: bearer(token) })).status).toBe(403);
    });

    it("usa el rol persistido y no un claim administrativo obsoleto", async () => {
        const app = new Hono();
        app.use("*", authUser(async () => ({ role: "user" }), noAudit));
        app.get("/", (c) => c.json(c.get("auth")));
        const token = JwtService.signAdminToken({
            userId: "operador-a",
            role: "admin",
            gymId: "gym-a",
        });

        const response = await app.request("/", { headers: bearer(token) });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ role: "user" });
    });
});
