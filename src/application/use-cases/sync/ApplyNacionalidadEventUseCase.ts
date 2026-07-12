import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";
import { normalizeBinary } from "../../../shared/utils/normalizeBinary";

export interface ApplyNacionalidadEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyNacionalidadEventUseCase {
    constructor(
        private readonly nacionalidadRepository: NacionalidadRepository
    ) { }

    async execute(input: ApplyNacionalidadEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            await this.nacionalidadRepository.softDelete(input.entidadId);
            return;
        }

        const nacionalidad = this.mapPayloadToNacionalidad(input);
        await this.nacionalidadRepository.upsertNacionalidad(nacionalidad);
    }

    private mapPayloadToNacionalidad(input: ApplyNacionalidadEventInput): Nacionalidad {
        const payload = input.payload as Record<string, unknown>;

        return {
            nacionalidad_id: input.entidadId,
            nacionalidad_nombre: String(payload.nacionalidad_nombre),
            codigo_iso: String(payload.codigo_iso),
            bandera: normalizeBinary(payload.bandera),
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
