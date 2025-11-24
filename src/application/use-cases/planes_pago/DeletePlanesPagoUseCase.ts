import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";

export class DeletePlanesPagoUseCase {
    constructor(private readonly planesPagoRepository: PlanesPagoRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.planesPagoRepository.findById(id);
        if (!existing) {
            throw new Error("PlanesPago not found");
        }

        await this.planesPagoRepository.softDelete(id);
    }
}
