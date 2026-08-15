import { Hono } from "hono";
import { MonedaController } from "../controllers/MonedaController";
import { requirePlatformAuthority } from "./global-catalog-authority";

export const monedaRoutes = new Hono();
const controller = new MonedaController();

monedaRoutes.get("/", (c) => controller.list(c));
monedaRoutes.get("/:id", (c) => controller.getById(c));
monedaRoutes.post("/", requirePlatformAuthority, (c) => controller.create(c));
monedaRoutes.put("/:id", requirePlatformAuthority, (c) => controller.update(c));
monedaRoutes.delete("/:id", requirePlatformAuthority, (c) => controller.delete(c));
