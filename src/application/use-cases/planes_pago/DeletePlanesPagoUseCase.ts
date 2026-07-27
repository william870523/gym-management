import { randomUUID } from "crypto";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeletePlanesPagoUseCase {
    constructor(
        private readonly planesPagoRepository: PlanesPagoRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.planesPagoRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("PlanesPago not found");
        }

        await this.planesPagoRepository.softDelete(id, gymId);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "planes_pago",
            operacion: "DELETE",
            entidadId: id,
            gymId,
            deviceId: "WEB_ADMIN",
            payload: { id_planes_pago: id }
        });
    }
}

