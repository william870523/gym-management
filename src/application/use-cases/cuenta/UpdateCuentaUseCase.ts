import type { UpdateCuentaDTO } from "../../dtos/CuentaDTO";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";

export class UpdateCuentaUseCase {
    constructor(private readonly cuentaRepository: CuentaRepository) { }

    async execute(id: string, dto: UpdateCuentaDTO): Promise<void> {
        const existing = await this.cuentaRepository.findById(id);
        if (!existing) {
            throw new Error("Cuenta not found");
        }

        const updateData: Partial<Cuenta> = {
            ...dto,
            updated_at: new Date()
        };

        await this.cuentaRepository.update(id, updateData);
    }
}
