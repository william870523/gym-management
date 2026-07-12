import type { Context } from "hono";
import { PrismaUserRepository } from "../../repositories/PrismaUserRepository";
import { PrismaSyncLogRepository } from "../../repositories/PrismaSyncLogRepository";
import { CreateUserUseCase } from "../../../application/use-cases/user/CreateUserUseCase";
import { UpdateUserUseCase } from "../../../application/use-cases/user/UpdateUserUseCase";
import { DeleteUserUseCase } from "../../../application/use-cases/user/DeleteUserUseCase";
import { ListUsersUseCase } from "../../../application/use-cases/user/ListUsersUseCase";
import { GetUserUseCase } from "../../../application/use-cases/user/GetUserUseCase";
import {
    CreateUserSchema, UpdateUserSchema
} from "../../../application/validation/users.schemas";

export class UserController {
    private listUseCase: ListUsersUseCase;
    private getUseCase: GetUserUseCase;
    private createUseCase: CreateUserUseCase;
    private updateUseCase: UpdateUserUseCase;
    private deleteUseCase: DeleteUserUseCase;

    constructor() {
        const repository = new PrismaUserRepository();
        const syncLogRepository = new PrismaSyncLogRepository();

        this.listUseCase = new ListUsersUseCase(repository);
        this.getUseCase = new GetUserUseCase(repository);
        this.createUseCase = new CreateUserUseCase(repository, syncLogRepository);
        this.updateUseCase = new UpdateUserUseCase(repository, syncLogRepository);
        this.deleteUseCase = new DeleteUserUseCase(repository, syncLogRepository);
    }

    async getUsers(c: Context) {
        try {
            const items = await this.listUseCase.execute();
            // Exclude password from result
            const sanitized = items.map(({ password, ...rest }) => rest);
            return c.json(sanitized);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async getUserById(c: Context) {
        try {
            const id = c.req.param("id");
            const item = await this.getUseCase.execute(id);
            if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
            const { password, ...sanitized } = item;
            return c.json(sanitized);
        } catch (error) {
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async createUser(c: Context) {
        try {
            const body = await c.req.json().catch(() => null);
            const parsed = CreateUserSchema.parse(body);
            const result = await this.createUseCase.execute(parsed);
            const { password, ...sanitized } = result;
            return c.json(sanitized, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: "Invalid data", details: error.format() }, 400);
            }
            if (error.message === "Email already in use") {
                return c.json({ error: error.message }, 409);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async updateUser(c: Context) {
        try {
            const id = c.req.param("id");
            const body = await c.req.json().catch(() => null);
            const parsed = UpdateUserSchema.parse(body);
            const result = await this.updateUseCase.execute(id, parsed);
            const { password, ...sanitized } = result;
            return c.json(sanitized);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: "Invalid data", details: error.format() }, 400);
            }
            if (error.message === "User not found") {
                return c.json({ error: error.message }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    async deleteUser(c: Context) {
        try {
            const id = c.req.param("id");
            await this.deleteUseCase.execute(id);
            return c.json({ ok: true });
        } catch (error: any) {
            if (error.message === "User not found") {
                return c.json({ error: error.message }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}

