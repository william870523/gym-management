import { prisma } from "../../../infrastructure/db/prismaClient";
import { logger } from "../../../config/logger";
import type { UploadEventsDTO } from "../../validation/sync.schemas";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import type { ApplyClienteEventUseCase } from "./ApplyClienteEventUseCase";
import type { ApplyClientePesoEventUseCase } from "./ApplyClientePesoEventUseCase";
import type { ApplyAsistenciaEventUseCase } from "./ApplyAsistenciaEventUseCase";
import type { ApplyPagoClienteEventUseCase } from "./ApplyPagoClienteEventUseCase";
import type { ApplyDetallePagoEventUseCase } from "./ApplyDetallePagoEventUseCase";
import type { ApplyMonedaEventUseCase } from "./ApplyMonedaEventUseCase";
import type { ApplyNacionalidadEventUseCase } from "./ApplyNacionalidadEventUseCase";
import type { ApplyTipoPagoEventUseCase } from "./ApplyTipoPagoEventUseCase";
import type { ApplyTipoCambioEventUseCase } from "./ApplyTipoCambioEventUseCase";
import type { ApplyReferenciaEventUseCase } from "./ApplyReferenciaEventUseCase";
import type { ApplyHorarioEventUseCase } from "./ApplyHorarioEventUseCase";
import type { ApplyPlanesPagoEventUseCase } from "./ApplyPlanesPagoEventUseCase";
import type { ApplyCuentaEventUseCase } from "./ApplyCuentaEventUseCase";
import type { ApplyEntrenadorEventUseCase } from "./ApplyEntrenadorEventUseCase";

export class UploadEventsUseCase {
    constructor(
        private readonly syncLogRepository: SyncLogRepository,
        private readonly applyClienteEventUseCase: ApplyClienteEventUseCase,
        private readonly applyClientePesoEventUseCase: ApplyClientePesoEventUseCase,
        private readonly applyAsistenciaEventUseCase: ApplyAsistenciaEventUseCase,
        private readonly applyPagoClienteEventUseCase: ApplyPagoClienteEventUseCase,
        private readonly applyDetallePagoEventUseCase: ApplyDetallePagoEventUseCase,
        private readonly applyMonedaEventUseCase: ApplyMonedaEventUseCase,
        private readonly applyNacionalidadEventUseCase: ApplyNacionalidadEventUseCase,
        private readonly applyTipoPagoEventUseCase: ApplyTipoPagoEventUseCase,
        private readonly applyTipoCambioEventUseCase: ApplyTipoCambioEventUseCase,
        private readonly applyReferenciaEventUseCase: ApplyReferenciaEventUseCase,
        private readonly applyHorarioEventUseCase: ApplyHorarioEventUseCase,
        private readonly applyPlanesPagoEventUseCase: ApplyPlanesPagoEventUseCase,
        private readonly applyCuentaEventUseCase: ApplyCuentaEventUseCase,
        private readonly applyEntrenadorEventUseCase: ApplyEntrenadorEventUseCase
    ) { }

    async execute(dto: UploadEventsDTO): Promise<{ processed: number }> {
        const { device_id, gym_id, events } = dto;
        let processed = 0;

        for (const ev of events) {
            // Idempotencia: verificar si ya existe
            const exists = await this.syncLogRepository.exists(ev.event_id);
            if (exists) {
                continue;
            }

            // Enrutamiento por entidad
            if (ev.entidad === "cliente") {
                await this.applyClienteEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "cliente_peso") {
                await this.applyClientePesoEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "asistencia") {
                await this.applyAsistenciaEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "pago_cliente") {
                await this.applyPagoClienteEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "detalle_pago") {
                await this.applyDetallePagoEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "moneda") {
                await this.applyMonedaEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "nacionalidad") {
                await this.applyNacionalidadEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "tipo_pago") {
                await this.applyTipoPagoEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "tipo_cambio") {
                await this.applyTipoCambioEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "referencia") {
                await this.applyReferenciaEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "horario") {
                await this.applyHorarioEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "planes_pago") {
                await this.applyPlanesPagoEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "cuenta") {
                await this.applyCuentaEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else if (ev.entidad === "entrenador") {
                await this.applyEntrenadorEventUseCase.execute({
                    eventId: ev.event_id,
                    entidadId: ev.entidad_id,
                    operacion: ev.operacion,
                    gymId: gym_id,
                    deviceId: device_id,
                    payload: ev.payload as Record<string, unknown>
                });
            } else {
                logger.warn("Entidad de sync no implementada en UploadEventsUseCase", {
                    entidad: ev.entidad,
                    operacion: ev.operacion,
                    entidad_id: ev.entidad_id
                });
                continue;
            }

            // Registrar en sync_log
            await this.syncLogRepository.register({
                eventId: ev.event_id,
                entidad: ev.entidad,
                operacion: ev.operacion,
                entidadId: ev.entidad_id,
                gymId: gym_id,
                deviceId: device_id,
                payload: ev.payload
            });

            processed++;
        }

        // Actualizar estado del cliente remoto
        try {
            await prisma.syncClientState.upsert({
                where: { device_id },
                create: {
                    device_id,
                    last_upload_at: new Date(),
                    last_seen_at: new Date()
                },
                update: {
                    last_upload_at: new Date(),
                    last_seen_at: new Date()
                }
            });
        } catch (err) {
            logger.error("Error actualizando SyncClientState", { err });
        }

        return { processed };
    }
}
