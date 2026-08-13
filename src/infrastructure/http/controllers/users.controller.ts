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
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import type { SyncTransactionRunner } from "../../../application/use-cases/sync/sync-transaction";

export class UserController {
    private listUseCase: ListUsersUseCase;
    private getUseCase: GetUserUseCase;
    private createUseCase: CreateUserUseCase;
    private updateUseCase: UpdateUserUseCase;
    private deleteUseCase: DeleteUserUseCase;

    constructor(
        repository: UserRepository = new PrismaUserRepository(),
        syncLogRepository: SyncLogRepository = new PrismaSyncLogRepository(),
        // Se propaga para que las pruebas puedan dar un ejecutor de mentira. Sin
        // esto, un test con repositorios dobles caería en el de producción y
        // abriría una transacción real de Prisma.
        enTransaccion?: SyncTransactionRunner,
    ) {
        this.listUseCase = new ListUsersUseCase(repository);
        this.getUseCase = new GetUserUseCase(repository);
        // Pasar `undefined` deja actuar al valor por defecto del caso de uso.
        this.createUseCase = new CreateUserUseCase(repository, syncLogRepository, enTransaccion);
        this.updateUseCase = new UpdateUserUseCase(repository, syncLogRepository, enTransaccion);
        this.deleteUseCase = new DeleteUserUseCase(repository, syncLogRepository, enTransaccion);
    }

    async getUsers(c: Context) {
        try {
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const items = await this.listUseCase.execute(gymId);
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
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const item = await this.getUseCase.execute(id, gymId);
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
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.createUseCase.execute(parsed, gymId);
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
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            const result = await this.updateUseCase.execute(id, parsed, gymId);
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
            const gymId = this.gymId(c);
            if (!gymId) return c.json({ error: "Gym scope required" }, 403);
            await this.deleteUseCase.execute(id, gymId);
            return c.json({ ok: true });
        } catch (error: any) {
            if (error.message === "User not found") {
                return c.json({ error: error.message }, 404);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    private gymId(c: Context): string | null {
        const auth = c.get("auth");
        return auth?.gymId?.trim() || null;
    }
}

