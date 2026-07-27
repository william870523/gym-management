import { randomUUID } from "crypto";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteClienteUseCase {
    constructor(
        private readonly clienteRepository: ClienteRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.clienteRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Cliente not found");
        }

        await this.clienteRepository.softDelete(id, gymId);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "cliente",
            operacion: "DELETE",
            entidadId: id,
            gymId: existing.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: { ci: id }
        });
    }
}

