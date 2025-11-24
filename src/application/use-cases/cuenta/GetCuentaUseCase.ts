import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";

export class GetCuentaUseCase {
    constructor(private readonly cuentaRepository: CuentaRepository) { }

    async execute(id: string): Promise<Cuenta | null> {
        return this.cuentaRepository.findById(id);
    }
}
