import { randomUUID } from "crypto";
import type { UpdateClienteDTO } from "../../dtos/ClienteDTO";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class UpdateClienteUseCase {
    constructor(
        private readonly clienteRepository: ClienteRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateClienteDTO, gymId: string): Promise<void> {
        const existing = await this.clienteRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Cliente not found");
        }

        const updateData: Partial<Cliente> = {
            ...dto,
            foto_cliente: dto.foto_cliente ? Buffer.from(dto.foto_cliente, 'base64') : undefined,
            fecha_inicio: dto.fecha_inicio ? new Date(dto.fecha_inicio) : undefined,
            fecha_fin: dto.fecha_fin ? new Date(dto.fecha_fin) : undefined,
            updated_at: trustedClock.nowUtc(),
            version: (existing.version ?? 0) + 1
        };

        await this.clienteRepository.update(id, gymId, updateData);

        const updated = await this.clienteRepository.findById(id, gymId);
        if (updated) {
            const nationalityCode = await this.clienteRepository.findNationalityCode(
                updated.nacionalidad_id,
            );
            if (!nationalityCode) {
                throw new Error("La nacionalidad del cliente no está disponible.");
            }
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cliente",
                operacion: "UPDATE",
                entidadId: id,
                gymId: updated.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: {
                    ...updated,
                    nacionalidad_codigo_iso: nationalityCode,
                    foto_cliente: updated.foto_cliente ? Buffer.from(updated.foto_cliente).toString('base64') : null
                } as any
            });
        }
    }
}

