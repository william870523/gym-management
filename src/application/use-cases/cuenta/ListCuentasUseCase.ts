import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";

export class ListCuentasUseCase {
    constructor(private readonly cuentaRepository: CuentaRepository) { }

    async execute(): Promise<Cuenta[]> {
        return this.cuentaRepository.findAll();
    }
}
