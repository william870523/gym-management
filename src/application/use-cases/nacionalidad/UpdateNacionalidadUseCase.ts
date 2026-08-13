import type { UpdateNacionalidadDTO } from "../../dtos/NacionalidadDTO";
import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";
import { normalizeBinary } from "../../../shared/utils/normalizeBinary";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";


export class UpdateNacionalidadUseCase {
    constructor(
        private readonly nacionalidadRepository: NacionalidadRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }


    async execute(id: string, dto: UpdateNacionalidadDTO): Promise<void> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const existing = await this.nacionalidadRepository.withTransaction(tx).findById(id);
            if (!existing) {
                throw new Error("Nacionalidad not found");
            }

            const updateData: Partial<Nacionalidad> = {
                ...dto,
                bandera: normalizeBinary(dto.bandera),
                updated_at: new Date()
            };

            await this.nacionalidadRepository.withTransaction(tx).update(id, updateData);

            // Record for sync
            const updated = await this.nacionalidadRepository.withTransaction(tx).findById(id);
            if (updated) {
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "nacionalidad",
                    operacion: "UPDATE",
                    entidadId: id,
                    gymId: null, // Global entity
                    deviceId: "WEB_ADMIN",
                    payload: {
                        ...updated,
                        bandera: updated.bandera ? Buffer.from(updated.bandera).toString('base64') : null
                    }
                }, tx);
            }
        });
    }
}

