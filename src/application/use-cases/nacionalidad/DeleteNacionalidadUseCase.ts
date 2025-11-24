import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";

export class DeleteNacionalidadUseCase {
    constructor(private readonly nacionalidadRepository: NacionalidadRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.nacionalidadRepository.findById(id);
        if (!existing) {
            throw new Error("Nacionalidad not found");
        }

        await this.nacionalidadRepository.softDelete(id);
    }
}
