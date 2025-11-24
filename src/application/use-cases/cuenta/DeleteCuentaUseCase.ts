import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";

export class DeleteCuentaUseCase {
    constructor(private readonly cuentaRepository: CuentaRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.cuentaRepository.findById(id);
        if (!existing) {
            throw new Error("Cuenta not found");
        }

        await this.cuentaRepository.softDelete(id);
    }
}
