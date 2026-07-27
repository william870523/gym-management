import { randomUUID } from "crypto";
import type { UpdatePlanesPagoDTO } from "../../dtos/PlanesPagoDTO";
import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { recargoMoraColumns } from "../../../domain/recargo-mora-policy";

export class UpdatePlanesPagoUseCase {
    constructor(
        private readonly planesPagoRepository: PlanesPagoRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdatePlanesPagoDTO, gymId: string): Promise<void> {
        const existing = await this.planesPagoRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("PlanesPago not found");
        }

        // Recargo por mora (docs/RECARGO_MORA.md): nunca se persiste crudo del
        // DTO. Si el administrador toca algún campo del recargo, se valida el
        // grupo completo mezclando con lo ya guardado.
        const {
            recargo_mora_modo,
            recargo_mora_valor,
            recargo_mora_tope,
            recargo_mora_activo,
            ...restDto
        } = dto;
        const moraTouched =
            recargo_mora_modo !== undefined ||
            recargo_mora_valor !== undefined ||
            recargo_mora_tope !== undefined ||
            recargo_mora_activo !== undefined;
        const current = existing as any;
        const moraColumns = moraTouched
            ? recargoMoraColumns({
                modo: recargo_mora_modo !== undefined
                    ? recargo_mora_modo : current.recargo_mora_modo,
                valor: recargo_mora_valor !== undefined
                    ? recargo_mora_valor : current.recargo_mora_valor,
                tope: recargo_mora_tope !== undefined
                    ? recargo_mora_tope : current.recargo_mora_tope,
                activo: recargo_mora_activo !== undefined
                    ? recargo_mora_activo : current.recargo_mora_activo,
            })
            : {};

        const updateData: Partial<PlanesPago> = {
            ...restDto,
            ...moraColumns,
            updated_at: trustedClock.nowUtc(),
            version: (existing.version ?? 0) + 1
        };

        await this.planesPagoRepository.update(id, gymId, updateData);

        const updated = await this.planesPagoRepository.findById(id, gymId);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "planes_pago",
                operacion: "UPDATE",
                entidadId: id,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            });
        }
    }
}

