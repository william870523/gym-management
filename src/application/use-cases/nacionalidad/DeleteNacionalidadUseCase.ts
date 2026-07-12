import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";


export class DeleteNacionalidadUseCase {
    constructor(
        private readonly nacionalidadRepository: NacionalidadRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }


    async execute(id: string): Promise<void> {
        const existing = await this.nacionalidadRepository.findById(id);
        if (!existing) {
            throw new Error("Nacionalidad not found");
        }

        await this.nacionalidadRepository.softDelete(id);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "nacionalidad",
            operacion: "DELETE",
            entidadId: id,
            gymId: null, // Global entity
            deviceId: "WEB_ADMIN",
            payload: { nacionalidad_id: id, is_deleted: true }
        });
    }
}

