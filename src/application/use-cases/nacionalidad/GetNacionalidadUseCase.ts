import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";

export class GetNacionalidadUseCase {
    constructor(private readonly nacionalidadRepository: NacionalidadRepository) { }

    async execute(id: string): Promise<Nacionalidad | null> {
        return this.nacionalidadRepository.findById(id);
    }
}
