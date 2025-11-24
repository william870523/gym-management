import { randomUUID } from "crypto";
import type { CreatePlanesPagoDTO } from "../../dtos/PlanesPagoDTO";
import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";

export class CreatePlanesPagoUseCase {
    constructor(private readonly planesPagoRepository: PlanesPagoRepository) { }

    async execute(dto: CreatePlanesPagoDTO): Promise<PlanesPago> {
        const newPlanesPago: PlanesPago = {
            id_planes_pago: randomUUID(),
            nombre_plan_pago: dto.nombre_plan_pago ?? null,
            importe_plan_pago: dto.importe_plan_pago,
            duracion_plan_pago: dto.duracion_plan_pago,
            activo: dto.activo ?? true,
            moneda_id: dto.moneda_id,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.planesPagoRepository.create(newPlanesPago);
        return newPlanesPago;
    }
}
