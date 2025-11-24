import { Hono } from "hono";
import * as trainers from "../controllers/trainers.controller";

export function trainersRoutes() {
    const app = new Hono();

    // Entrenador
    app.get("/entrenadores", trainers.getEntrenadores);
    app.get("/entrenadores/:id", trainers.getEntrenadorById);
    app.post("/entrenadores", trainers.createEntrenador);
    app.put("/entrenadores/:id", trainers.updateEntrenador);
    app.delete("/entrenadores/:id", trainers.deleteEntrenador);

    return app;
}
