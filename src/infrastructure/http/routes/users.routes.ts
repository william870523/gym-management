import { Hono } from "hono";
import { UserController } from "../controllers/users.controller";

export function usersRoutes() {
    const app = new Hono();
    const controller = new UserController();

    app.get("/", (c) => controller.getUsers(c));
    app.get("/:id", (c) => controller.getUserById(c));

    app.post("/", (c) => controller.createUser(c));
    app.put("/:id", (c) => controller.updateUser(c));

    app.delete("/:id", (c) => controller.deleteUser(c));

    return app;
}

