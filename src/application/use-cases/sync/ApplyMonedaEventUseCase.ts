import type { Moneda } from "../../../domain/entities/Moneda";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";

export interface ApplyMonedaEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyMonedaEventUseCase {
    constructor(
        private readonly monedaRepository: MonedaRepository
    ) { }

    async execute(input: ApplyMonedaEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            return;
        }

        const moneda = this.mapPayloadToMoneda(input);
        await this.monedaRepository.upsertMoneda(moneda);
    }

    private mapPayloadToMoneda(input: ApplyMonedaEventInput): Moneda {
        const payload = input.payload as Record<string, unknown>;

        return {
            moneda_id: input.entidadId,
            moneda_nombre: String(payload.moneda_nombre),
            codigo: String(payload.codigo),
            simbolo: (payload.simbolo as string | null) ?? null,
            imagen: payload.imagen ? Buffer.from(String(payload.imagen), 'base64') : null,
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
