import { randomUUID } from "crypto";
import type { UpdateCuentaDTO } from "../../dtos/CuentaDTO";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class UpdateCuentaUseCase {
    constructor(
        private readonly cuentaRepository: CuentaRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(id: string, dto: UpdateCuentaDTO, gymId: string): Promise<void> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const existing = await this.cuentaRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("Cuenta not found");
            }

            const updateData: Partial<Cuenta> = {
                ...dto,
                updated_at: trustedClock.nowUtc(),
                version: (existing.version ?? 0) + 1
            };

            await this.cuentaRepository.withTransaction(tx).update(id, gymId, updateData);

            const updated = await this.cuentaRepository.withTransaction(tx).findById(id, gymId);
            if (updated) {
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "cuenta",
                    operacion: "UPDATE",
                    entidadId: id,
                    gymId: updated.gym_id,
                    deviceId: "WEB_ADMIN",
                    payload: updated as any
                }, tx);
            }
        });
    }
}

