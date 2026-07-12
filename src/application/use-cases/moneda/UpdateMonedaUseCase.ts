import type { UpdateMonedaDTO } from "../../dtos/MonedaDTO";
import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";

export class UpdateMonedaUseCase {
    constructor(
        private readonly monedaRepository: MonedaRepository,
        private readonly syncLogRepository: SyncLogRepository
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

        await this.monedaRepository.update(id, updateData);

        // Record for sync
        const updated = await this.monedaRepository.findById(id);
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
            });
        }
    }
}
