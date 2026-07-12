import { randomUUID } from "crypto";
import type { CreateClienteDTO } from "../../dtos/ClienteDTO";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class CreateClienteUseCase {
    constructor(
        private readonly clienteRepository: ClienteRepository,
        private readonly syncLogRepository: SyncLogRepository,
        private readonly clientePesoRepository: ClientePesoRepository
    ) { }

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

        // Record for sync (Cliente Link)
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "cliente",
            operacion: "INSERT",
            entidadId: newCliente.ci,
            gymId: newCliente.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: {
                ...newCliente,
                foto_cliente: newCliente.foto_cliente ? Buffer.from(newCliente.foto_cliente).toString('base64') : null
            } as any
        });

        // Handle Weight Logic
        if (dto.peso !== undefined && dto.peso !== null) {
            const pesoId = randomUUID();
            const pesoRecord = {
                cliente_peso_id: pesoId,
                ci: newCliente.ci,
                peso: Number(dto.peso),
                fecha: newCliente.fecha_inicio,
                gym_id: newCliente.gym_id ?? null,
                source_device: "WEB_ADMIN",
                version: 1,
                created_at: new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false,
                sync_status: 'pending' // Optional depending on entity definition
            };

            // 1. Create Weight
            await this.clientePesoRepository.create(pesoRecord);

            // 2. Sync Weight
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cliente_peso",
                operacion: "INSERT",
                entidadId: pesoId,
                gymId: newCliente.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: {
                    ...pesoRecord,
                    fecha: pesoRecord.fecha.toISOString(),
                    created_at: pesoRecord.created_at.toISOString(),
                    updated_at: pesoRecord.updated_at.toISOString(),
                } as any
            });

            // 3. Update Client with Weight ID
            newCliente.cliente_peso_id = pesoId;
            await this.clienteRepository.update(newCliente.ci, { cliente_peso_id: pesoId });

            // 4. Sync Client Update
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cliente",
                operacion: "UPDATE",
                entidadId: newCliente.ci,
                gymId: newCliente.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: {
                    ...newCliente,
                    foto_cliente: newCliente.foto_cliente ? Buffer.from(newCliente.foto_cliente).toString('base64') : null
                } as any
            });
        }

        return newCliente;
    }
}

