import type { UpdatePlanesPagoDTO } from "../../dtos/PlanesPagoDTO";
import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";

export class UpdatePlanesPagoUseCase {
    constructor(private readonly planesPagoRepository: PlanesPagoRepository) { }

    async execute(id: string, dto: UpdatePlanesPagoDTO): Promise<void> {
        const existing = await this.planesPagoRepository.findById(id);
        if (!existing) {
            throw new Error("PlanesPago not found");
        }

        const updateData: Partial<PlanesPago> = {
            ...dto,
            updated_at: new Date()
        };

        await this.planesPagoRepository.update(id, updateData);
    }
}
