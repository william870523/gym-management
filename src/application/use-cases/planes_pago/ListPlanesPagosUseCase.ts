import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";

export class ListPlanesPagosUseCase {
    constructor(private readonly planesPagoRepository: PlanesPagoRepository) { }

    async execute(gymId: string): Promise<PlanesPago[]> {
        return this.planesPagoRepository.findAll(gymId);
    }
}
