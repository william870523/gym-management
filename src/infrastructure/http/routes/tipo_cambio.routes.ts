import { Hono } from "hono";
import { TipoCambioController } from "../controllers/TipoCambioController";
import { requirePlatformAuthority } from "./global-catalog-authority";

export const tipoCambioRoutes = new Hono();
const controller = new TipoCambioController();

tipoCambioRoutes.get("/", (c) => controller.list(c));
tipoCambioRoutes.put("/:id/recargos/sede", (c) => controller.replaceSiteSurcharges(c));
tipoCambioRoutes.delete("/:id/recargos/sede", (c) => controller.resetSiteSurcharges(c));
tipoCambioRoutes.put("/:id/recargos/global", requirePlatformAuthority, (c) => controller.replaceGlobalSurcharges(c));
tipoCambioRoutes.get("/:id", (c) => controller.getById(c));
tipoCambioRoutes.post("/", requirePlatformAuthority, (c) => controller.create(c));
tipoCambioRoutes.put("/:id", requirePlatformAuthority, (c) => controller.update(c));
tipoCambioRoutes.delete("/:id", requirePlatformAuthority, (c) => controller.delete(c));
