import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";

export class GetPlanesPagoUseCase {
    constructor(private readonly planesPagoRepository: PlanesPagoRepository) { }

    async execute(id: string, gymId: string): Promise<PlanesPago | null> {
        return this.planesPagoRepository.findById(id, gymId);
    }
}
