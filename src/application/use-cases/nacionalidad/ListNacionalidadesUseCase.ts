import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";

export class ListNacionalidadesUseCase {
    constructor(private readonly nacionalidadRepository: NacionalidadRepository) { }

    async execute(): Promise<Nacionalidad[]> {
        return this.nacionalidadRepository.findAll();
    }
}
