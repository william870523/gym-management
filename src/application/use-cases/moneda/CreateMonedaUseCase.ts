import { v4 as uuidv4 } from "uuid";
import type { CreateMonedaDTO } from "../../dtos/MonedaDTO";
import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";

export class CreateMonedaUseCase {
    constructor(
        private readonly monedaRepository: MonedaRepository,
        private readonly syncLogRepository: SyncLogRepository
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

        await this.monedaRepository.create(newMoneda);

        // Record for sync
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
        });

        return newMoneda;
    }
}
