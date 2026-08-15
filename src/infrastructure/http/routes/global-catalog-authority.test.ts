import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { requirePlatformAuthority } from "./global-catalog-authority";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

function app(esPlataforma: boolean) {
  const api = new Hono<{ Variables: { auth: AuthTokenPayload } }>();
  api.use("*", async (c, next) => {
    c.set("auth", { sub: "m3-test", role: "admin", esPlataforma });
    await next();
  });
  api.post("/catalog", requirePlatformAuthority, (c) => c.json({ ok: true }));
  return api;
}

describe("M3 autoridad de catálogos globales", () => {
  it("rechaza una escritura administrativa de sede", async () => {
    const response = await app(false).request("/catalog", { method: "POST" });
    expect(response.status).toBe(403);
    const body = await response.json() as { error_code: string };
    expect(body.error_code).toBe("PLATFORM_AUTHORITY_REQUIRED");
  });

  it("permite la escritura a la autoridad de plataforma", async () => {
    const response = await app(true).request("/catalog", { method: "POST" });
    expect(response.status).toBe(200);
  });
});
