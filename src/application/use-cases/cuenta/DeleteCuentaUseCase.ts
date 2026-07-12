import { randomUUID } from "crypto";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteCuentaUseCase {
    constructor(
        private readonly cuentaRepository: CuentaRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.cuentaRepository.findById(id);
        if (!existing) {
            throw new Error("Cuenta not found");
        }

        await this.cuentaRepository.softDelete(id);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "cuenta",
            operacion: "DELETE",
            entidadId: id,
            gymId: existing.gym_id,
            deviceId: "WEB_ADMIN",
            payload: { cuenta_id: id }
        });
    }
}

