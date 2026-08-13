import { randomUUID } from "crypto";
import type { CreateCuentaDTO } from "../../dtos/CuentaDTO";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreateCuentaUseCase {
    constructor(
        private readonly cuentaRepository: CuentaRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreateCuentaDTO, gymId: string): Promise<Cuenta> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const now = trustedClock.nowUtc();
            const newCuenta: Cuenta = {
                cuenta_id: randomUUID(),
                nombre_cuenta: dto.nombre_cuenta,
                moneda_id: dto.moneda_id,
                tipo_pago_id: dto.tipo_pago_id || null,
                gym_id: gymId,
                source_device: "WEB_ADMIN",
                version: 1,
                created_at: now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            };

            await this.cuentaRepository.withTransaction(tx).create(newCuenta, gymId);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cuenta",
                operacion: "INSERT",
                entidadId: newCuenta.cuenta_id,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: newCuenta as any
            }, tx);

            return newCuenta;
        });
    }
}

