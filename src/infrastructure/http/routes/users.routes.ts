import { Hono } from "hono";
import { UserController } from "../controllers/users.controller";
import { authAny, requirePermission } from "../middleware/auth.middleware";

export function usersRoutes() {
    const app = new Hono();
    const controller = new UserController();

    // Base Auth (Loads User & Permissions) - handled in server.ts
    // app.use("*", authAny());

    // User Routes with Granular Permissions
    app.get("/", requirePermission('users.read'), (c) => controller.getUsers(c));
    app.get("/:id", requirePermission('users.read'), (c) => controller.getUserById(c));

    app.post("/", requirePermission('users.write'), (c) => controller.createUser(c));
    app.put("/:id", requirePermission('users.write'), (c) => controller.updateUser(c));

    app.delete("/:id", requirePermission('users.delete'), (c) => controller.deleteUser(c));

    return app;
}

