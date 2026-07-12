import { randomUUID } from "crypto";
import type { CreatePlanesPagoDTO } from "../../dtos/PlanesPagoDTO";
import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class CreatePlanesPagoUseCase {
    constructor(
        private readonly planesPagoRepository: PlanesPagoRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreatePlanesPagoDTO): Promise<PlanesPago> {
        const newPlanesPago: PlanesPago = {
            id_planes_pago: randomUUID(),
            nombre_plan_pago: dto.nombre_plan_pago ?? null,
            importe_plan_pago: dto.importe_plan_pago,
            duracion_plan_pago: dto.duracion_plan_pago,
            activo: dto.activo ?? true,
            moneda_id: dto.moneda_id,
            incluye_entrenador: dto.incluye_entrenador ?? false,
            comision_entrenador_tipo: dto.comision_entrenador_tipo ?? "NONE",
            comision_entrenador_valor: dto.comision_entrenador_valor ?? null,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.planesPagoRepository.create(newPlanesPago);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "planes_pago",
            operacion: "INSERT",
            entidadId: newPlanesPago.id_planes_pago,
            gymId: newPlanesPago.gym_id,
            deviceId: "WEB_ADMIN",
            payload: newPlanesPago as any
        });

        return newPlanesPago;
    }
}

