import type { UpdateClienteDTO } from "../../dtos/ClienteDTO";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";

export class UpdateClienteUseCase {
    constructor(private readonly clienteRepository: ClienteRepository) { }

    async execute(id: string, dto: UpdateClienteDTO): Promise<void> {
        const existing = await this.clienteRepository.findById(id);
        if (!existing) {
            throw new Error("Cliente not found");
        }

        const updateData: Partial<Cliente> = {
            ...dto,
            foto_cliente: dto.foto_cliente ? Buffer.from(dto.foto_cliente, 'base64') : undefined,
            fecha_inicio: dto.fecha_inicio ? new Date(dto.fecha_inicio) : undefined,
            fecha_fin: dto.fecha_fin ? new Date(dto.fecha_fin) : undefined,
            updated_at: new Date()
        };

        await this.clienteRepository.update(id, updateData);
    }
}
