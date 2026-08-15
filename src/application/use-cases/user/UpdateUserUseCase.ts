import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { User } from "@prisma/client";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export interface UpdateUserDTO {
    user_nombre?: string;
    user_email?: string;
    password?: string;
    role?: "admin" | "reception" | "accounting" | "trainer";
    active?: boolean;
}

export class UpdateUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(id: string, dto: UpdateUserDTO, gymId: string): Promise<User> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const existing = await this.userRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("User not found");
            }

            const updateData: any = { ...dto };
            if (dto.password) {
                updateData.password = await bcrypt.hash(dto.password, 10);
            } else {
                delete updateData.password;
            }

            updateData.updated_at = trustedClock.nowUtc();
            updateData.version = (existing.version ?? 0) + 1;

            const updated = await this.userRepository.withTransaction(tx).update(id, gymId, updateData);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: uuidv4(),
                entidad: "user",
                operacion: "UPDATE",
                entidadId: id,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            }, tx);

            return updated;
        });
    }
}

