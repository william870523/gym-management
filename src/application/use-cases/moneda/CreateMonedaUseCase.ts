import { v4 as uuidv4 } from "uuid";
import type { CreateMonedaDTO } from "../../dtos/MonedaDTO";
import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreateMonedaUseCase {
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

    async execute(dto: CreateMonedaDTO): Promise<Moneda> {
        const newMoneda: Moneda = {
            moneda_id: dto.moneda_id ?? uuidv4(),
            moneda_nombre: dto.moneda_nombre,
            codigo: dto.codigo,
            simbolo: dto.simbolo ?? null,
            imagen: dto.imagen ? Buffer.from(dto.imagen, 'base64') : null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo entre
        // los dos `await` dejaba la moneda creada en MariaDB sin evento que la
        // anunciara: el escritorio no se enteraba nunca y las dos bases quedaban
        // distintas para siempre, sin nada que lo delatara.
        await this.enTransaccion(async (tx) => {
            await this.monedaRepository.withTransaction(tx).create(newMoneda);
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "moneda",
                operacion: "INSERT",
                entidadId: newMoneda.moneda_id,
                gymId: null, // Global entity
                deviceId: "WEB_ADMIN",
                payload: {
                    ...newMoneda,
                    imagen: newMoneda.imagen ? Buffer.from(newMoneda.imagen).toString('base64') : null
                }
            }, tx);
        });

        return newMoneda;
    }
}
