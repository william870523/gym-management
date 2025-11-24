import { Hono } from "hono";
import { NacionalidadController } from "../controllers/NacionalidadController";

const nacionalidadRoutes = new Hono();
const controller = new NacionalidadController();

nacionalidadRoutes.get("/", (c) => controller.list(c));
nacionalidadRoutes.get("/:id", (c) => controller.getById(c));
nacionalidadRoutes.post("/", (c) => controller.create(c));
nacionalidadRoutes.put("/:id", (c) => controller.update(c));
nacionalidadRoutes.delete("/:id", (c) => controller.delete(c));

export { nacionalidadRoutes };
