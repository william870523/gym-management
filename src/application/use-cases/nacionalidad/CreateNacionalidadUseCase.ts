import { randomUUID } from "crypto";
import { normalizeBinary } from "../../../shared/utils/normalizeBinary";
import type { CreateNacionalidadDTO } from "../../dtos/NacionalidadDTO";
import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";


export class CreateNacionalidadUseCase {
    constructor(
        private readonly nacionalidadRepository: NacionalidadRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }


    async execute(dto: CreateNacionalidadDTO): Promise<Nacionalidad> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            // Check for existing nationality (even if deleted) to avoid unique constraint violations
            const existing = await this.nacionalidadRepository.withTransaction(tx).findByCode(dto.codigo_iso);

            if (existing) {
                const updated: Nacionalidad = {
                    ...existing,
                    nacionalidad_nombre: dto.nacionalidad_nombre,
                    bandera: normalizeBinary(dto.bandera) ?? existing.bandera,
                    version: existing.version + 1,
                    updated_at: new Date(),
                    is_deleted: false,
                    deleted_at: null
                };
                await this.nacionalidadRepository.withTransaction(tx).upsertNacionalidad(updated);
                // Record for sync (UPDATE operation since we are restoring/updating)
                // We use the EXISTING ID, not a new one
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "nacionalidad",
                    operacion: "UPDATE",
                    entidadId: existing.nacionalidad_id,
                    gymId: null,
                    deviceId: "WEB_ADMIN",
                    payload: {
                        ...updated,
                        bandera: updated.bandera ? Buffer.from(updated.bandera).toString('base64') : null
                    }
                }, tx);
                return updated;
            }

            const newNacionalidad: Nacionalidad = {
                nacionalidad_id: dto.nacionalidad_id ?? randomUUID(),
                nacionalidad_nombre: dto.nacionalidad_nombre,
                codigo_iso: dto.codigo_iso,
                bandera: normalizeBinary(dto.bandera) ?? null,
                version: 1,
                created_at: new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            };

            await this.nacionalidadRepository.withTransaction(tx).create(newNacionalidad);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "nacionalidad",
                operacion: "INSERT",
                entidadId: newNacionalidad.nacionalidad_id,
                gymId: null, // Global entity
                deviceId: "WEB_ADMIN",
                payload: {
                    ...newNacionalidad,
                    bandera: newNacionalidad.bandera ? Buffer.from(newNacionalidad.bandera).toString('base64') : null
                }
            }, tx);

            return newNacionalidad;
        });
    }
}

