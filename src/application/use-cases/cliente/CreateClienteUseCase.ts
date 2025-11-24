import type { CreateClienteDTO } from "../../dtos/ClienteDTO";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";

export class CreateClienteUseCase {
    constructor(private readonly clienteRepository: ClienteRepository) { }

    async execute(dto: CreateClienteDTO): Promise<Cliente> {
        const newCliente: Cliente = {
            ci: dto.ci,
            nombres: dto.nombres,
            apellidos: dto.apellidos,
            sexo: dto.sexo,
            foto_cliente: dto.foto_cliente ? Buffer.from(dto.foto_cliente, 'base64') : null,
            cliente_peso_id: dto.cliente_peso_id,
            estatura_cliente: dto.estatura_cliente,
            direccion: dto.direccion ?? null,
            telefono: dto.telefono ?? null,
            nacionalidad_id: dto.nacionalidad_id,
            correo: dto.correo ?? null,
            objetivo: dto.objetivo ?? null,
            id_planes_pago: dto.id_planes_pago,
            id_entrenador: dto.id_entrenador ?? null,
            fecha_inicio: new Date(dto.fecha_inicio),
            fecha_fin: new Date(dto.fecha_fin),
            activo: dto.activo,
            id_horarios: dto.id_horarios,
            referencia_id: dto.referencia_id ?? null,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.clienteRepository.create(newCliente);
        return newCliente;
    }
}
