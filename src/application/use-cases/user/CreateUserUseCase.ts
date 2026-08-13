import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { User } from "@prisma/client";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export interface CreateUserDTO {
    user_nombre: string;
    user_email: string;
    password: string;
    role: "admin" | "user";
    active?: boolean;
}

export class CreateUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreateUserDTO, gymId: string): Promise<User> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const authenticatedGymId = gymId.trim();
            if (!authenticatedGymId) throw new Error("Gym scope required");
            if (await this.userRepository.withTransaction(tx).findByEmail(dto.user_email)) {
                throw new Error("Email already in use");
            }
            const now = trustedClock.nowUtc();
            const passwordHash = await bcrypt.hash(dto.password, 10);

            const newUser: User = await this.userRepository.withTransaction(tx).create({
                user_id: uuidv4(),
                user_nombre: dto.user_nombre,
                user_email: dto.user_email,
                password: passwordHash,
                role: dto.role,
                gym_id: authenticatedGymId,
                source_device: "WEB_ADMIN",
                active: dto.active ?? true,
                is_deleted: false,
                created_at: now,
                updated_at: now,
                deleted_at: null,
                version: 1,
            }, authenticatedGymId);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: uuidv4(),
                entidad: "user",
                operacion: "INSERT",
                entidadId: newUser.user_id,
                gymId: authenticatedGymId,
                deviceId: "WEB_ADMIN",
                payload: newUser as any
            }, tx);

            return newUser;
        });
    }
}
