import { randomUUID } from "crypto";
import type { CreateClienteDTO } from "../../dtos/ClienteDTO";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { resolverFechaNacimiento } from "../../clients/client-birthdate";
import { fechaNegocioDeSede } from "../../clients/business-date";
import { quitarProyeccionesDeCliente } from "../sync/sync-event-contract";
import type {
    SyncTransactionContext,
    SyncTransactionRunner,
} from "../sync/sync-transaction";

export class CreateClienteUseCase {
    constructor(
        private readonly clienteRepository: ClienteRepository,
        private readonly syncLogRepository: SyncLogRepository,
        private readonly clientePesoRepository: ClientePesoRepository,
        private readonly runTransaction: SyncTransactionRunner,
        private readonly businessDateForGym: (
            gymId: string,
            instant: Date,
        ) => Promise<Date> = fechaNegocioDeSede,
    ) { }

    async execute(dto: CreateClienteDTO, gymId: string): Promise<Cliente & {
        membresia_id?: string | null;
        membresia_estado?: string | null;
        membresia_vigencia?: string | null;
        membresia_dias_desde_vencimiento?: number | null;
        membresia_cubre_hoy?: boolean | null;
    }> {
        const now = trustedClock.nowUtc();
        // E0 (§7-bis): la fecha de nacimiento la fija el servidor. Con carné
        // cubano se deriva de los 11 dígitos y lo que venga en el DTO se ignora.
        const fecha_nacimiento = resolverFechaNacimiento({
            tipoDocumento: dto.tipo_documento,
            ci: dto.ci,
            fechaNacimientoEntrante: dto.fecha_nacimiento,
            fechaNegocio: await this.businessDateForGym(gymId, now),
            esAlta: true,
        });
        const newCliente: Cliente = {
            ci: dto.ci,
            tipo_documento: dto.tipo_documento,
            fecha_nacimiento,
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
            // R5.3 — la categoría decide el precio; si no viaja hasta aquí, el
            // esquema pone «NUEVO» por defecto y el socio VIEJO se cobra mal.
            categoria: dto.categoria ?? "NUEVO",
            gym_id: gymId,
            source_device: null,
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            is_deleted: false
        };

        // La mutación y todos sus eventos de descarga son una sola unidad. Antes
        // de este corte el repositorio confirmaba cliente/membresía/asignación y
        // solo después se escribía `sync_log`: un fallo en el log dejaba una
        // alta visible en web que nunca podía llegar al escritorio.
        return this.runTransaction(async (tx: SyncTransactionContext) => {
            const clienteRepository = this.clienteRepository.withTransaction(tx);
            const clientePesoRepository = this.clientePesoRepository.withTransaction(tx);
            const creation = await clienteRepository.create(newCliente);
            const createdClient = creation.client;

            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cliente",
                operacion: "INSERT",
                entidadId: createdClient.ci,
                gymId: createdClient.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: quitarProyeccionesDeCliente({
                    ...createdClient,
                    nacionalidad_codigo_iso: creation.nationalityCode,
                    foto_cliente: createdClient.foto_cliente
                        ? Buffer.from(createdClient.foto_cliente).toString("base64")
                        : null,
                }) as any,
            }, tx);

            if (creation.membership) {
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "membresia_cliente",
                    operacion: "INSERT",
                    entidadId: creation.membership.membresia_id,
                    gymId: creation.membership.gym_id,
                    deviceId: "WEB_ADMIN",
                    payload: creation.membership as any,
                }, tx);
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
                }, tx);
            }

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
                    sync_status: "pending",
                };
                await clientePesoRepository.create(pesoRecord);
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
                    } as any,
                }, tx);

                createdClient.cliente_peso_id = pesoId;
                await clienteRepository.update(createdClient.ci, gymId, {
                    cliente_peso_id: pesoId,
                });
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "cliente",
                    operacion: "UPDATE",
                    entidadId: createdClient.ci,
                    gymId: createdClient.gym_id ?? null,
                    deviceId: "WEB_ADMIN",
                    payload: quitarProyeccionesDeCliente({
                        ...createdClient,
                        nacionalidad_codigo_iso: creation.nationalityCode,
                        foto_cliente: createdClient.foto_cliente
                            ? Buffer.from(createdClient.foto_cliente).toString("base64")
                            : null,
                    }) as any,
                }, tx);
            }

            // Se relee dentro de la misma transacción: la respuesta no puede
            // fallar después del commit ni discrepar de la ficha/listado.
            const proyeccion = creation.membership
                ? await clienteRepository.findById(createdClient.ci, gymId)
                : null;
            return {
                ...createdClient,
                membresia_id: creation.membership?.membresia_id ?? null,
                membresia_estado: creation.membership?.estado ?? null,
                membresia_vigencia:
                    proyeccion?.membresia_vigencia ?? "SIN_MEMBRESIA",
                membresia_dias_desde_vencimiento:
                    proyeccion?.membresia_dias_desde_vencimiento ?? null,
                membresia_cubre_hoy: proyeccion?.membresia_cubre_hoy ?? false,
            };
        });
    }
}
