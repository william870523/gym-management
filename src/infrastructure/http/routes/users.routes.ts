import { Hono } from "hono";
import * as users from "../controllers/users.controller";
import { authAdmin } from "../middleware/auth.middleware";

export function usersRoutes() {
    const app = new Hono();

    // Protected Routes
    app.use("*", authAdmin());

    // User
    app.get("/", users.getUsers);
    app.get("/:id", users.getUserById);
    app.post("/", users.createUser);
    app.put("/:id", users.updateUser);
    app.delete("/:id", users.deleteUser);

    return app;
}
