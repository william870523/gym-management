import { randomUUID } from "crypto";
import type { CreateClienteDTO } from "../../dtos/ClienteDTO";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class CreateClienteUseCase {
    constructor(
        private readonly clienteRepository: ClienteRepository,
        private readonly syncLogRepository: SyncLogRepository,
        private readonly clientePesoRepository: ClientePesoRepository
    ) { }

    async execute(dto: CreateClienteDTO, gymId: string): Promise<Cliente & {
        membresia_id?: string | null;
        membresia_estado?: string | null;
        membresia_vigencia?: string | null;
        membresia_dias_desde_vencimiento?: number | null;
        membresia_cubre_hoy?: boolean | null;
    }> {
        const now = trustedClock.nowUtc();
        const newCliente: Cliente = {
            ci: dto.ci,
            tipo_documento: dto.tipo_documento,
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
            // El repositorio fuerza false cuando existe un plan y crea una
            // membresía pendiente de cobro en la misma transacción.
            activo: dto.id_planes_pago ? false : Boolean(dto.activo),
            id_horarios: dto.id_horarios,
            referencia_id: dto.referencia_id ?? null,
            gym_id: gymId,
            source_device: null,
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            is_deleted: false
        };

        const creation = await this.clienteRepository.create(newCliente);
        const createdClient = creation.client;

        // Record for sync (Cliente Link)
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "cliente",
            operacion: "INSERT",
            entidadId: createdClient.ci,
            gymId: createdClient.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: {
                ...createdClient,
                nacionalidad_codigo_iso: creation.nationalityCode,
                foto_cliente: createdClient.foto_cliente ? Buffer.from(createdClient.foto_cliente).toString('base64') : null
            } as any
        });

        if (creation.membership) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "membresia_cliente",
                operacion: "INSERT",
                entidadId: creation.membership.membresia_id,
                gymId: creation.membership.gym_id,
                deviceId: "WEB_ADMIN",
                payload: creation.membership as any,
            });
        }
        if (creation.assignment) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "membresia_entrenador_asignacion",
                operacion: "INSERT",
                entidadId: creation.assignment.asignacion_id,
                gymId: creation.assignment.gym_id,
                deviceId: "WEB_ADMIN",
                payload: creation.assignment as any,
            });
        }

        // Handle Weight Logic
        if (dto.peso !== undefined && dto.peso !== null) {
            const pesoId = randomUUID();
            const pesoRecord = {
                cliente_peso_id: pesoId,
                ci: createdClient.ci,
                peso: Number(dto.peso),
                fecha: createdClient.fecha_inicio,
                gym_id: createdClient.gym_id ?? null,
                source_device: "WEB_ADMIN",
                version: 1,
                created_at: now,
                updated_at: now,
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
            createdClient.cliente_peso_id = pesoId;
            await this.clienteRepository.update(
                createdClient.ci,
                gymId,
                { cliente_peso_id: pesoId },
            );

            // 4. Sync Client Update
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cliente",
                operacion: "UPDATE",
                entidadId: createdClient.ci,
                gymId: createdClient.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: {
                    ...createdClient,
                    nacionalidad_codigo_iso: creation.nationalityCode,
                    foto_cliente: createdClient.foto_cliente ? Buffer.from(createdClient.foto_cliente).toString('base64') : null
                } as any
            });
        }

        // La vigencia la deriva el repositorio, que es quien conoce la zona
        // horaria de la sede. Se relee la ficha recién creada en vez de repetir
        // el cálculo aquí: si el alta y el listado lo resolvieran por separado,
        // acabarían discrepando (docs/DEMO_MEMBERSHIP_VIGENCIA.md).
        const proyeccion = creation.membership
            ? await this.clienteRepository.findById(createdClient.ci, gymId)
            : null;
        return {
            ...createdClient,
            membresia_id: creation.membership?.membresia_id ?? null,
            membresia_estado: creation.membership?.estado ?? null,
            membresia_vigencia: proyeccion?.membresia_vigencia ?? "SIN_MEMBRESIA",
            membresia_dias_desde_vencimiento:
                proyeccion?.membresia_dias_desde_vencimiento ?? null,
            membresia_cubre_hoy: proyeccion?.membresia_cubre_hoy ?? false,
        };
    }
}

