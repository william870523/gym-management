import { randomUUID } from "crypto";
import type { UpdatePlanesPagoDTO } from "../../dtos/PlanesPagoDTO";
import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class UpdatePlanesPagoUseCase {
    constructor(
        private readonly planesPagoRepository: PlanesPagoRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdatePlanesPagoDTO): Promise<void> {
        const existing = await this.planesPagoRepository.findById(id);
        if (!existing) {
            throw new Error("PlanesPago not found");
        }

        const updateData: Partial<PlanesPago> = {
            ...dto,
            updated_at: new Date(),
            version: (existing.version ?? 0) + 1
        };

        await this.planesPagoRepository.update(id, updateData);

        const updated = await this.planesPagoRepository.findById(id);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "planes_pago",
                operacion: "UPDATE",
                entidadId: id,
                gymId: updated.gym_id,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            });
        }
    }
}

