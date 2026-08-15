import { Hono } from "hono";
import { ReferenciaController } from "../controllers/ReferenciaController";
import { requirePlatformAuthority } from "./global-catalog-authority";

export const referenciaRoutes = new Hono();
const controller = new ReferenciaController();

referenciaRoutes.get("/", (c) => controller.list(c));
referenciaRoutes.get("/:id", (c) => controller.getById(c));
referenciaRoutes.post("/", requirePlatformAuthority, (c) => controller.create(c));
referenciaRoutes.put("/:id", requirePlatformAuthority, (c) => controller.update(c));
referenciaRoutes.delete("/:id", requirePlatformAuthority, (c) => controller.delete(c));
