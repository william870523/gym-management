import { Hono } from "hono";
import { CuentaController } from "../controllers/CuentaController";

export const cuentaRoutes = new Hono();
const controller = new CuentaController();

cuentaRoutes.get("/", (c) => controller.list(c));
cuentaRoutes.get("/:id", (c) => controller.getById(c));
cuentaRoutes.post("/", (c) => controller.create(c));
cuentaRoutes.put("/:id", (c) => controller.update(c));
cuentaRoutes.delete("/:id", (c) => controller.delete(c));
