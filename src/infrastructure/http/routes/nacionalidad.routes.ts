import { Hono } from "hono";
import { NacionalidadController } from "../controllers/NacionalidadController";
import { requirePlatformAuthority } from "./global-catalog-authority";

const nacionalidadRoutes = new Hono();
const controller = new NacionalidadController();

nacionalidadRoutes.get("/", (c) => controller.list(c));
nacionalidadRoutes.get("/:id", (c) => controller.getById(c));
nacionalidadRoutes.post("/", requirePlatformAuthority, (c) => controller.create(c));
nacionalidadRoutes.put("/:id", requirePlatformAuthority, (c) => controller.update(c));
nacionalidadRoutes.delete("/:id", requirePlatformAuthority, (c) => controller.delete(c));

export { nacionalidadRoutes };
