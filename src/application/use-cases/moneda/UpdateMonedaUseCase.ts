import type { UpdateMonedaDTO } from "../../dtos/MonedaDTO";
import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class UpdateMonedaUseCase {
    constructor(
        private readonly monedaRepository: MonedaRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback
        // sin sustituir el módulo de Prisma para toda la suite.
        // El `as` es por los solapamientos de `$transaction` en Prisma, que
        // tiene una firma para arrays y otra para callbacks; la inferencia se
        // queda con la de arrays.
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(id: string, dto: UpdateMonedaDTO): Promise<void> {
        const existing = await this.monedaRepository.findById(id);
        if (!existing) {
            throw new Error("Moneda not found");
        }

        const updateData: Partial<Moneda> = {
            ...dto,
            imagen: dto.imagen ? Buffer.from(dto.imagen, 'base64') : undefined,
            updated_at: new Date()
        };

        // La fila y su evento, en la misma transacción: ver `CreateMonedaUseCase`.
        // La relectura va dentro a propósito, para que el payload sea el que
        // quedó y no uno que otra escritura pudiera haber pisado entretanto.
        await this.enTransaccion(async (tx) => {
            const repo = this.monedaRepository.withTransaction(tx);
            await repo.update(id, updateData);

            const updated = await repo.findById(id);
            if (updated) {
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "moneda",
                    operacion: "UPDATE",
                    entidadId: id,
                    gymId: null, // Global entity
                    deviceId: "WEB_ADMIN",
                    payload: {
                        ...updated,
                        imagen: updated.imagen ? Buffer.from(updated.imagen).toString('base64') : null
                    }
                }, tx);
            }
        });
    }
}
