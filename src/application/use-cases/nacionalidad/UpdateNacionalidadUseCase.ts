import type { UpdateNacionalidadDTO } from "../../dtos/NacionalidadDTO";
import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";
import { normalizeBinary } from "../../../shared/utils/normalizeBinary";


export class UpdateNacionalidadUseCase {
    constructor(
        private readonly nacionalidadRepository: NacionalidadRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }


    async execute(id: string, dto: UpdateNacionalidadDTO): Promise<void> {
        const existing = await this.nacionalidadRepository.findById(id);
        if (!existing) {
            throw new Error("Nacionalidad not found");
        }

        const updateData: Partial<Nacionalidad> = {
            ...dto,
            bandera: normalizeBinary(dto.bandera),
            updated_at: new Date()
        };

        await this.nacionalidadRepository.update(id, updateData);

        // Record for sync
        const updated = await this.nacionalidadRepository.findById(id);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "nacionalidad",
                operacion: "UPDATE",
                entidadId: id,
                gymId: null, // Global entity
                deviceId: "WEB_ADMIN",
                payload: {
                    ...updated,
                    bandera: updated.bandera ? Buffer.from(updated.bandera).toString('base64') : null
                }
            });
        }
    }
}

