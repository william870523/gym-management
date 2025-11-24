import { Hono } from "hono";
import * as users from "../controllers/users.controller";

export function usersRoutes() {
    const app = new Hono();

    // User
    app.get("/users", users.getUsers);
    app.get("/users/:id", users.getUserById);
    app.post("/users", users.createUser);
    app.put("/users/:id", users.updateUser);
    app.delete("/users/:id", users.deleteUser);

    return app;
}
