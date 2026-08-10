import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { corsMiddleware } from "./cors";
import { GYM_CONTEXT_HEADER } from "../infrastructure/http/middleware/auth.middleware";

/**
 * El CORS de la web es un fallo silencioso peligroso: una cabecera que no esté
 * en `allowHeaders` no se cae sola, **se cae la petición entera**, y como
 * cualquier cabecera propia dispara un preflight, la web se queda sin poder
 * llamar a nada. El escritorio no lo nota porque fuera del navegador no hay
 * CORS, así que sin esta prueba el fallo solo aparece en producción.
 *
 * Pasó el 27-07-2026 con `X-Gym-Id`.
 */
function app() {
    const app = new Hono();
    app.use("*", corsMiddleware());
    app.get("/health", (c) => c.json({ status: "ok-remote" }));
    return app;
}

async function preflight(headers: string) {
    return app().request("http://gymos.test/health", {
        method: "OPTIONS",
        headers: {
            Origin: "http://localhost:5599",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": headers,
        },
    });
}

const allowed = (response: Response) =>
    (response.headers.get("Access-Control-Allow-Headers") ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase());

describe("CORS de la web", () => {
    it("admite la cabecera de sede activa", async () => {
        // Sin esto, el navegador bloquea TODAS las llamadas en cuanto la sesión
        // resuelve una sede, incluidas las públicas como /health.
        const response = await preflight(GYM_CONTEXT_HEADER);
        expect(allowed(response)).toContain(GYM_CONTEXT_HEADER.toLowerCase());
    });

    it("admite las cabeceras que la web manda en cada petición", async () => {
        const response = await preflight(
            `Authorization, Content-Type, Cache-Control, ${GYM_CONTEXT_HEADER}`,
        );
        const lista = allowed(response);
        for (const cabecera of [
            "authorization",
            "content-type",
            "cache-control",
            GYM_CONTEXT_HEADER.toLowerCase(),
        ]) {
            expect(lista).toContain(cabecera);
        }
    });

    it("deja pasar una petición simple con la sede declarada", async () => {
        const response = await app().request("http://gymos.test/health", {
            headers: {
                Origin: "http://localhost:5599",
                [GYM_CONTEXT_HEADER]: "local-gym-001",
            },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    });
});
