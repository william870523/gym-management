import { Hono } from "hono";
import { UserController } from "../controllers/users.controller";
import {
    deleteUsuarioSede,
    getUsuarioSedes,
    putUsuarioSede,
} from "../controllers/usuario-sede.controller";

export function usersRoutes() {
    const app = new Hono();
    const controller = new UserController();

    app.get("/", (c) => controller.getUsers(c));
    app.get("/:id/sedes", getUsuarioSedes);
    app.put("/:id/sedes/:gymId", putUsuarioSede);
    app.delete("/:id/sedes/:gymId", deleteUsuarioSede);
    app.get("/:id", (c) => controller.getUserById(c));

    app.post("/", (c) => controller.createUser(c));
    app.put("/:id", (c) => controller.updateUser(c));

    app.delete("/:id", (c) => controller.deleteUser(c));

    return app;
}

