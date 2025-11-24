import { Hono } from "hono";
import { HorarioController } from "../controllers/HorarioController";

export const horarioRoutes = new Hono();
const controller = new HorarioController();

horarioRoutes.get("/", (c) => controller.list(c));
horarioRoutes.get("/:id", (c) => controller.getById(c));
horarioRoutes.post("/", (c) => controller.create(c));
horarioRoutes.put("/:id", (c) => controller.update(c));
horarioRoutes.delete("/:id", (c) => controller.delete(c));
