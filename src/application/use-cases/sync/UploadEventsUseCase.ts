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
import type { ApplyUserEventUseCase } from "./ApplyUserEventUseCase";
import type { ApplyGymEventUseCase } from "./ApplyGymEventUseCase";
import { trustedClock } from "../../../config/trusted-clock";
import { createHash } from "crypto";

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
    private readonly applyEntrenadorEventUseCase: ApplyEntrenadorEventUseCase,
    private readonly applyUserEventUseCase: ApplyUserEventUseCase,
    private readonly applyGymEventUseCase: ApplyGymEventUseCase,
  ) {}

  async execute(dto: UploadEventsDTO): Promise<{ processed: number }> {
    const { device_id, gym_id, events } = dto;
    let processed = 0;

    for (const ev of events) {
      // Idempotencia: verificar si ya existe
      const exists = await this.syncLogRepository.exists(ev.event_id);
      if (exists) {
        continue;
      }

      let effectivePayload = ev.payload as Record<string, unknown>;
      if (ev.entidad === "cliente") {
        effectivePayload =
          await this.canonicalizeClientReferences(effectivePayload);
      }

      // Enrutamiento por entidad
      if (ev.entidad === "cliente") {
        await this.applyClienteEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
        });
      } else if (ev.entidad === "user") {
        await this.applyUserEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "gym") {
        await this.applyGymEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "cliente_peso") {
        await this.applyClientePesoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "asistencia") {
        await this.applyAsistenciaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "pago_cliente") {
        await this.applyPagoClienteEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "detalle_pago") {
        await this.applyDetallePagoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "moneda") {
        await this.applyMonedaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "nacionalidad") {
        await this.applyNacionalidadEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "tipo_pago") {
        await this.applyTipoPagoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "tipo_cambio") {
        await this.applyTipoCambioEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "referencia") {
        await this.applyReferenciaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "horario") {
        await this.applyHorarioEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "planes_pago") {
        await this.applyPlanesPagoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "cuenta") {
        await this.applyCuentaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: ev.payload as Record<string, unknown>,
        });
      } else if (ev.entidad === "entrenador") {
        await this.applyEntrenadorEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
        });
      } else if (
        [
          "configuracion_sistema",
          "entrenador_comision_regla",
          "entrenador_compensacion_perfil",
          "entrenador_obligacion_fija",
          "entrenador_baja_expediente",
          "entrenador_baja_decision",
          "entrenador_baja_comision_ajuste",
          "membresia_ajuste_financiero",
          "cliente_credito",
          "credito_membresia_aplicacion",
          "cliente_reembolso_tesoreria",
          "cliente_reembolso_reversion",
          "entrenador_comision_devengo",
          "entrenador_comision_cuota",
          "entrenador_liquidacion",
          "entrenador_liquidacion_aplicacion",
          "entrenador_liquidacion_obligacion_aplicacion",
          "entrenador_liquidacion_reversion",
          "tesoreria_operacion_manual",
          "tesoreria_movimiento",
          "tesoreria_cierre",
          "tesoreria_cierre_solicitud",
          "tesoreria_conciliacion",
          "tesoreria_cierre_mensual",
          "membresia_cliente",
          "membresia_pausa",
          "membresia_solicitud",
          "retencion_gestion",
          "membresia_entrenador_asignacion",
          "pago_membresia_aplicacion",
          "pago_reversion",
          "gasto_categoria",
          "gasto_proveedor",
          "gasto_gobernado",
          "gasto_gobernado_aplicacion",
        ].includes(ev.entidad)
      ) {
        await this.applyPrismaMappedEvent(ev, gym_id, device_id);
      } else {
        logger.warn("Entidad de sync no implementada en UploadEventsUseCase", {
          entidad: ev.entidad,
          operacion: ev.operacion,
          entidad_id: ev.entidad_id,
        });
        continue;
      }

      const globalEntities = [
        "moneda",
        "monedas",
        "nacionalidad",
        "nacionalidades",
        "tipo_pago",
        "tipo_cambio",
        "referencia",
      ];
      const effectiveGymId = globalEntities.includes(ev.entidad)
        ? null
        : gym_id;

      // Registrar en sync_log
      await this.syncLogRepository.register({
        eventId: ev.event_id,
        entidad: ev.entidad,
        operacion: ev.operacion,
        entidadId: ev.entidad_id,
        gymId: effectiveGymId,
        deviceId: device_id,
        payload: effectivePayload,
      });

      processed++;
    }

    // Actualizar estado del cliente remoto
    try {
      await prisma.syncClientState.upsert({
        where: { device_id },
        create: {
          device_id,
          last_upload_at: trustedClock.nowUtc(),
          last_seen_at: trustedClock.nowUtc(),
        },
        update: {
          last_upload_at: trustedClock.nowUtc(),
          last_seen_at: trustedClock.nowUtc(),
        },
      });
    } catch (err) {
      logger.error("Error actualizando SyncClientState", { err });
    }

    return { processed };
  }

  private async canonicalizeClientReferences(payload: Record<string, unknown>) {
    const incomingId = String(payload.nacionalidad_id ?? "");
    const incomingCode = String(payload.nacionalidad_codigo_iso ?? "")
      .trim()
      .toUpperCase();
    const byId = incomingId
      ? await prisma.nacionalidad.findUnique({
          where: { nacionalidad_id: incomingId },
        })
      : null;
    const nationality =
      byId && !byId.is_deleted
        ? byId
        : incomingCode
          ? await prisma.nacionalidad.findUnique({
              where: { codigo_iso: incomingCode },
            })
          : null;

    if (!nationality || nationality.is_deleted) {
      throw new Error(
        `No se pudo resolver la nacionalidad ${incomingId || "sin ID"}` +
          `${incomingCode ? ` (${incomingCode})` : ""}.`,
      );
    }

    return {
      ...payload,
      nacionalidad_id: nationality.nacionalidad_id,
      nacionalidad_codigo_iso: nationality.codigo_iso,
    };
  }

  private async applyPrismaMappedEvent(
    ev: UploadEventsDTO["events"][number],
    gymId: string,
    deviceId: string,
  ) {
    const mapping: Record<string, { delegate: any; pk: string }> = {
      configuracion_sistema: {
        delegate: (prisma as any).configuracionSistema,
        pk: "configuracion_id",
      },
      entrenador_comision_regla: {
        delegate: (prisma as any).entrenadorComisionRegla,
        pk: "regla_id",
      },
      entrenador_compensacion_perfil: {
        delegate: (prisma as any).entrenadorCompensacionPerfil,
        pk: "perfil_id",
      },
      entrenador_obligacion_fija: {
        delegate: (prisma as any).entrenadorObligacionFija,
        pk: "obligacion_id",
      },
      entrenador_baja_expediente: {
        delegate: (prisma as any).entrenadorBajaExpediente,
        pk: "expediente_id",
      },
      entrenador_baja_decision: {
        delegate: (prisma as any).entrenadorBajaDecision,
        pk: "decision_id",
      },
      entrenador_baja_comision_ajuste: {
        delegate: (prisma as any).entrenadorBajaComisionAjuste,
        pk: "ajuste_id",
      },
      membresia_ajuste_financiero: {
        delegate: (prisma as any).membresiaAjusteFinanciero,
        pk: "ajuste_financiero_id",
      },
      cliente_credito: {
        delegate: (prisma as any).clienteCredito,
        pk: "credito_id",
      },
      credito_membresia_aplicacion: {
        delegate: (prisma as any).creditoMembresiaAplicacion,
        pk: "aplicacion_id",
      },
      cliente_reembolso_tesoreria: {
        delegate: (prisma as any).clienteReembolsoTesoreria,
        pk: "reembolso_id",
      },
      cliente_reembolso_reversion: {
        delegate: (prisma as any).clienteReembolsoReversion,
        pk: "reversion_id",
      },
      entrenador_comision_devengo: {
        delegate: (prisma as any).entrenadorComisionDevengo,
        pk: "devengo_id",
      },
      entrenador_comision_cuota: {
        delegate: (prisma as any).entrenadorComisionCuota,
        pk: "cuota_id",
      },
      entrenador_liquidacion: {
        delegate: (prisma as any).entrenadorLiquidacion,
        pk: "liquidacion_id",
      },
      entrenador_liquidacion_aplicacion: {
        delegate: (prisma as any).entrenadorLiquidacionAplicacion,
        pk: "aplicacion_id",
      },
      entrenador_liquidacion_obligacion_aplicacion: {
        delegate: (prisma as any).entrenadorLiquidacionObligacionAplicacion,
        pk: "aplicacion_id",
      },
      entrenador_liquidacion_reversion: {
        delegate: (prisma as any).entrenadorLiquidacionReversion,
        pk: "reversion_id",
      },
      tesoreria_operacion_manual: {
        delegate: (prisma as any).tesoreriaOperacionManual,
        pk: "operacion_manual_id",
      },
      tesoreria_movimiento: {
        delegate: (prisma as any).tesoreriaMovimiento,
        pk: "movimiento_id",
      },
      tesoreria_cierre: {
        delegate: (prisma as any).tesoreriaCierre,
        pk: "cierre_id",
      },
      tesoreria_cierre_solicitud: {
        delegate: (prisma as any).tesoreriaCierreSolicitud,
        pk: "solicitud_id",
      },
      tesoreria_conciliacion: {
        delegate: (prisma as any).tesoreriaConciliacion,
        pk: "conciliacion_id",
      },
      tesoreria_cierre_mensual: {
        delegate: (prisma as any).tesoreriaCierreMensual,
        pk: "cierre_mensual_id",
      },
      membresia_cliente: {
        delegate: (prisma as any).membresiaCliente,
        pk: "membresia_id",
      },
      membresia_pausa: {
        delegate: (prisma as any).membresiaPausa,
        pk: "pausa_id",
      },
      membresia_solicitud: {
        delegate: (prisma as any).membresiaSolicitud,
        pk: "solicitud_id",
      },
      retencion_gestion: {
        delegate: (prisma as any).retencionGestion,
        pk: "gestion_id",
      },
      membresia_entrenador_asignacion: {
        delegate: (prisma as any).membresiaEntrenadorAsignacion,
        pk: "asignacion_id",
      },
      pago_membresia_aplicacion: {
        delegate: (prisma as any).pagoMembresiaAplicacion,
        pk: "aplicacion_id",
      },
      pago_reversion: {
        delegate: (prisma as any).pagoReversion,
        pk: "reversion_id",
      },
    };
    const target = mapping[ev.entidad];
    if (!target) return;

    const payload = this.normalizeDates({
      ...(ev.payload as Record<string, unknown>),
    });
    const record: Record<string, unknown> = {
      ...payload,
      [target.pk]: ev.entidad_id ?? payload[target.pk],
      // El gimnasio autoritativo proviene del JWT del dispositivo y del
      // DTO ya contrastado por el controlador de sincronización.
      gym_id: gymId,
      source_device: payload.source_device ?? deviceId,
    };

    if (ev.entidad === "configuracion_sistema" && ev.operacion !== "DELETE") {
      const key = String(record.clave ?? "").trim();
      if (!key) {
        throw new Error(
          `No se puede sincronizar la configuración ${ev.entidad_id}: falta clave.`,
        );
      }
      delete record.source_device;
      const update = { ...record };
      delete update.configuracion_id;
      delete update.gym_id;
      delete update.created_at;
      await target.delegate.upsert({
        where: { clave_gym_id: { clave: key, gym_id: gymId } },
        create: record,
        update,
      });
      return;
    }

    if (ev.entidad === "tesoreria_cierre_mensual") {
      if (ev.operacion === "DELETE") {
        throw new Error("Un cierre mensual auditado no se puede eliminar por sincronización.");
      }
      const month = String(record.mes ?? "").trim();
      const state = String(record.estado ?? "").trim().toUpperCase();
      const snapshotJson = String(record.resumen_snapshot_json ?? "");
      const expectedHash = createHash("sha256").update(snapshotJson).digest("hex");
      const start = new Date(String(record.fecha_desde ?? ""));
      const endExclusive = new Date(String(record.fecha_hasta_exclusiva ?? ""));
      const expectedStart = /^\d{4}-\d{2}$/.test(month)
        ? new Date(`${month}-01T00:00:00.000Z`)
        : new Date(Number.NaN);
      const expectedEnd = Number.isNaN(expectedStart.getTime())
        ? new Date(Number.NaN)
        : new Date(Date.UTC(
            expectedStart.getUTCFullYear(),
            expectedStart.getUTCMonth() + 1,
            1,
          ));
      let snapshot: any = null;
      try {
        snapshot = JSON.parse(snapshotJson);
      } catch {
        snapshot = null;
      }
      const closerId = String(record.cerrado_por_user_id ?? "");
      const reopenerId = String(record.reabierto_por_user_id ?? "");
      const [closer, reopener, existing] = await Promise.all([
        closerId
          ? prisma.user.findFirst({
              where: { user_id: closerId, gym_id: gymId },
              select: { user_id: true },
            })
          : null,
        reopenerId
          ? prisma.user.findFirst({
              where: { user_id: reopenerId, gym_id: gymId },
              select: { user_id: true },
            })
          : null,
        prisma.tesoreriaCierreMensual.findUnique({
          where: { cierre_mensual_id: ev.entidad_id },
        }),
      ]);
      const lockKey = record.bloqueo_clave == null
        ? null
        : String(record.bloqueo_clave);
      const validState = state === "CERRADO" || state === "REABIERTO";
      const validLock = state === "CERRADO"
        ? lockKey === `${gymId}|${month}`
        : lockKey == null;
      const validReopen = state === "REABIERTO"
        ? Boolean(
            record.reapertura_operacion_id &&
            record.reapertura_motivo &&
            record.reabierto_at &&
            reopener,
          )
        : record.reapertura_operacion_id == null;
      const immutableConflict = existing && (
        existing.gym_id !== gymId ||
        existing.mes !== month ||
        existing.operacion_id !== String(record.operacion_id ?? "") ||
        existing.motivo_cierre !== String(record.motivo_cierre ?? "") ||
        existing.resumen_snapshot_json !== snapshotJson ||
        existing.resumen_sha256 !== String(record.resumen_sha256 ?? "") ||
        existing.cerrado_por_user_id !== closerId ||
        existing.fecha_desde.getTime() !== start.getTime() ||
        existing.fecha_hasta_exclusiva.getTime() !== endExclusive.getTime()
      );
      if (
        !validState ||
        !validLock ||
        !validReopen ||
        !closer ||
        !snapshot ||
        snapshot.gym_id !== gymId ||
        snapshot.mes !== month ||
        expectedHash !== String(record.resumen_sha256 ?? "") ||
        Number.isNaN(start.getTime()) ||
        Number.isNaN(endExclusive.getTime()) ||
        start.getTime() !== expectedStart.getTime() ||
        endExclusive.getTime() !== expectedEnd.getTime() ||
        (ev.operacion === "INSERT" && state !== "CERRADO") ||
        (ev.operacion === "UPDATE" && !existing) ||
        Boolean(immutableConflict)
      ) {
        throw new Error(
          `No se puede sincronizar el cierre mensual ${ev.entidad_id}: ` +
            "la firma, el período, los actores o la fotografía auditada no son válidos.",
        );
      }
    }

    if (
      [
        "tesoreria_movimiento",
        "tesoreria_cierre",
        "tesoreria_cierre_solicitud",
        "tesoreria_conciliacion",
      ].includes(ev.entidad) &&
      ev.operacion !== "DELETE"
    ) {
      const businessDate = new Date(String(record.fecha_negocio ?? ""));
      if (!Number.isNaN(businessDate.getTime())) {
        const month = businessDate.toISOString().slice(0, 7);
        const monthlyLock = await prisma.tesoreriaCierreMensual.findFirst({
          where: {
            gym_id: gymId,
            mes: month,
            estado: "CERRADO",
            bloqueo_clave: { not: null },
            is_deleted: false,
          },
          select: { cierre_mensual_id: true },
        });
        if (monthlyLock) {
          throw new Error(
            `El período ${month} está cerrado; el evento ${ev.entidad} ` +
              `${ev.entidad_id} requiere una reapertura auditada.`,
          );
        }
      }
    }

    if (ev.entidad === "membresia_cliente" && ev.operacion !== "DELETE") {
      const clientId = String(record.ci ?? "");
      const client = clientId
        ? await prisma.cliente.findFirst({
            where: { ci: clientId, gym_id: gymId, is_deleted: false },
            select: { ci: true },
          })
        : null;
      if (!client) {
        throw new Error(
          `No se puede sincronizar la membresía ${ev.entidad_id}: ` +
            `el cliente ${clientId || "sin CI"} no existe en el gimnasio.`,
        );
      }
    }

    if (
      (ev.entidad === "membresia_pausa" ||
        ev.entidad === "membresia_solicitud" ||
        ev.entidad === "retencion_gestion") &&
      ev.operacion !== "DELETE"
    ) {
      const membershipId = String(record.membresia_id ?? "");
      const membership = membershipId
        ? await prisma.membresiaCliente.findFirst({
            where: {
              membresia_id: membershipId,
              gym_id: gymId,
              is_deleted: false,
            },
            select: { membresia_id: true },
          })
        : null;
      if (!membership) {
        throw new Error(
          `No se puede sincronizar ${
            ev.entidad === "membresia_pausa"
              ? "la pausa"
              : ev.entidad === "membresia_solicitud"
                ? "la solicitud"
                : "la gestión de retención"
          } ${ev.entidad_id}: ` +
            `la membresía ${membershipId || "sin ID"} no existe en el gimnasio.`,
        );
      }
    }

    if (ev.entidad === "entrenador_liquidacion" && ev.operacion !== "DELETE") {
      const trainerId = String(record.id_entrenador ?? "");
      const accountId = String(record.cuenta_id ?? "");
      const [trainer, account] = await Promise.all([
        trainerId
          ? prisma.entrenador.findFirst({
              where: {
                id_entrenador: trainerId,
                gym_id: gymId,
              },
              select: { id_entrenador: true },
            })
          : null,
        accountId
          ? prisma.cuenta.findFirst({
              where: { cuenta_id: accountId, gym_id: gymId },
              select: { cuenta_id: true },
            })
          : null,
      ]);
      if (!trainer || !account) {
        throw new Error(
          `No se puede sincronizar la liquidación ${ev.entidad_id}: ` +
            "el entrenador o la cuenta no pertenece al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "tesoreria_operacion_manual" &&
      ev.operacion !== "DELETE"
    ) {
      const accountIds = [
        String(record.cuenta_origen_id ?? ""),
        String(record.cuenta_destino_id ?? ""),
      ].filter(Boolean);
      const accounts = accountIds.length
        ? await prisma.cuenta.findMany({
            where: {
              cuenta_id: { in: accountIds },
              gym_id: gymId,
              is_deleted: false,
            },
            select: { cuenta_id: true, moneda_id: true },
          })
        : [];
      if (
        accounts.length !== accountIds.length ||
        accounts.some(
          (account) => account.moneda_id !== String(record.moneda_id ?? ""),
        )
      ) {
        throw new Error(
          `No se puede sincronizar la operación manual ${ev.entidad_id}: ` +
            "sus cuentas o moneda no pertenecen al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "tesoreria_conciliacion" &&
      ev.operacion !== "DELETE"
    ) {
      const closeId = String(record.cierre_id ?? "");
      const accountId = String(record.cuenta_id ?? "");
      const currencyId = String(record.moneda_id ?? "");
      let movementIds: string[] = [];
      try {
        const parsed = JSON.parse(String(record.movimiento_ids_json ?? "[]"));
        movementIds = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        movementIds = [];
      }
      const [close, movements] = await Promise.all([
        closeId
          ? prisma.tesoreriaCierre.findFirst({
              where: {
                cierre_id: closeId,
                gym_id: gymId,
                is_deleted: false,
              },
              select: {
                cierre_id: true,
                cuenta_id: true,
                moneda_id: true,
                fecha_negocio: true,
              },
            })
          : null,
        movementIds.length
          ? prisma.tesoreriaMovimiento.findMany({
              where: {
                movimiento_id: { in: movementIds },
                gym_id: gymId,
                cuenta_id: accountId,
                moneda_id: currencyId,
                is_deleted: false,
              },
              select: { movimiento_id: true, fecha_negocio: true },
            })
          : [],
      ]);
      const businessDate = new Date(String(record.fecha_negocio ?? ""));
      if (
        !close ||
        close.cuenta_id !== accountId ||
        close.moneda_id !== currencyId ||
        Number.isNaN(businessDate.getTime()) ||
        close.fecha_negocio.getTime() !== businessDate.getTime() ||
        movements.length !== movementIds.length ||
        movements.some(
          (movement) =>
            movement.fecha_negocio.getTime() !== close.fecha_negocio.getTime(),
        )
      ) {
        throw new Error(
          `No se puede sincronizar la conciliación ${ev.entidad_id}: ` +
            "el cierre, los movimientos, la cuenta o la moneda no pertenecen al gimnasio autenticado.",
        );
      }
    }

    if (
      (ev.entidad === "tesoreria_movimiento" ||
        ev.entidad === "tesoreria_cierre" ||
        ev.entidad === "tesoreria_cierre_solicitud") &&
      ev.operacion !== "DELETE"
    ) {
      const accountId = String(record.cuenta_id ?? "");
      const account = accountId
        ? await prisma.cuenta.findFirst({
            where: {
              cuenta_id: accountId,
              gym_id: gymId,
              is_deleted: false,
            },
            select: { cuenta_id: true, moneda_id: true },
          })
        : null;
      if (
        (ev.entidad === "tesoreria_cierre" ||
          ev.entidad === "tesoreria_cierre_solicitud") &&
        !account
      ) {
        throw new Error(
          `No se puede sincronizar el arqueo ${ev.entidad_id}: ` +
            "la cuenta no pertenece al gimnasio autenticado.",
        );
      }
      if (account && account.moneda_id !== String(record.moneda_id ?? "")) {
        throw new Error(
          `No se puede sincronizar ${ev.entidad} ${ev.entidad_id}: ` +
            "la moneda no corresponde a la cuenta.",
        );
      }
    }

    if (
      ev.entidad === "tesoreria_cierre_solicitud" &&
      ev.operacion !== "DELETE"
    ) {
      const accountId = String(record.cuenta_id ?? "");
      const currencyId = String(record.moneda_id ?? "");
      const requesterId = String(record.solicitada_por_user_id ?? "");
      const deciderId = String(record.decidida_por_user_id ?? "");
      const closeId = String(record.cierre_id ?? "");
      const state = String(record.estado ?? "").toUpperCase();
      const businessDate = new Date(String(record.fecha_negocio ?? ""));
      let movementIds: string[] = [];
      try {
        const parsed = JSON.parse(String(record.movimiento_ids_json ?? "[]"));
        movementIds = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        throw new Error(
          `No se puede sincronizar la solicitud ${ev.entidad_id}: ` +
            "la fotografía de movimientos no es válida.",
        );
      }
      const [requester, decider, movements, close] = await Promise.all([
        requesterId
          ? prisma.user.findFirst({
              where: { user_id: requesterId, gym_id: gymId },
              select: { user_id: true },
            })
          : null,
        deciderId
          ? prisma.user.findFirst({
              where: { user_id: deciderId, gym_id: gymId },
              select: { user_id: true },
            })
          : null,
        movementIds.length
          ? prisma.tesoreriaMovimiento.findMany({
              where: {
                movimiento_id: { in: movementIds },
                gym_id: gymId,
                cuenta_id: accountId,
                moneda_id: currencyId,
                is_deleted: false,
              },
              select: { movimiento_id: true, fecha_negocio: true },
            })
          : [],
        closeId
          ? prisma.tesoreriaCierre.findFirst({
              where: {
                cierre_id: closeId,
                gym_id: gymId,
                is_deleted: false,
              },
              select: {
                cierre_id: true,
                solicitud_id: true,
                cuenta_id: true,
                moneda_id: true,
                fecha_negocio: true,
              },
            })
          : null,
      ]);
      const invalidActors = !requester || (deciderId.length > 0 && !decider);
      const invalidMovements =
        Number.isNaN(businessDate.getTime()) ||
        movements.length !== movementIds.length ||
        movements.some(
          (movement) =>
            movement.fecha_negocio.getTime() !== businessDate.getTime(),
        );
      const invalidClose =
        state === "APROBADA"
          ? !close ||
            close.solicitud_id !== ev.entidad_id ||
            close.cuenta_id !== accountId ||
            close.moneda_id !== currencyId ||
            close.fecha_negocio.getTime() !== businessDate.getTime()
          : closeId.length > 0;
      if (invalidActors || invalidMovements || invalidClose) {
        throw new Error(
          `No se puede sincronizar la solicitud ${ev.entidad_id}: ` +
            "los actores, movimientos o cierre no pertenecen al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "entrenador_compensacion_perfil" &&
      ev.operacion !== "DELETE"
    ) {
      const trainerId = String(record.id_entrenador ?? "");
      const accountId = String(record.cuenta_preferida_id ?? "");
      const [trainer, account] = await Promise.all([
        trainerId
          ? prisma.entrenador.findFirst({
              where: { id_entrenador: trainerId, gym_id: gymId },
              select: { id_entrenador: true },
            })
          : null,
        accountId
          ? prisma.cuenta.findFirst({
              where: { cuenta_id: accountId, gym_id: gymId },
              select: { cuenta_id: true },
            })
          : true,
      ]);
      if (!trainer || !account) {
        throw new Error(
          `No se puede sincronizar el perfil ${ev.entidad_id}: ` +
            "el entrenador o la cuenta no pertenece al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "entrenador_obligacion_fija" &&
      ev.operacion !== "DELETE"
    ) {
      const profileId = String(record.perfil_compensacion_id ?? "");
      const trainerId = String(record.id_entrenador ?? "");
      const [profile, trainer] = await Promise.all([
        profileId
          ? prisma.entrenadorCompensacionPerfil.findFirst({
              where: { perfil_id: profileId, gym_id: gymId, is_deleted: false },
              select: { perfil_id: true, id_entrenador: true },
            })
          : null,
        trainerId
          ? prisma.entrenador.findFirst({
              where: { id_entrenador: trainerId, gym_id: gymId },
              select: { id_entrenador: true },
            })
          : null,
      ]);
      if (!profile || !trainer || profile.id_entrenador !== trainer.id_entrenador) {
        throw new Error(
          `No se puede sincronizar la obligación fija ${ev.entidad_id}: ` +
            "el perfil o el entrenador no pertenece al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "entrenador_baja_expediente" &&
      ev.operacion !== "DELETE"
    ) {
      const trainerId = String(record.id_entrenador ?? "");
      const trainer = trainerId
        ? await prisma.entrenador.findFirst({
            where: {
              id_entrenador: trainerId,
              gym_id: gymId,
              is_deleted: false,
            },
            select: { id_entrenador: true },
          })
        : null;
      if (!trainer) {
        throw new Error(
          `No se puede sincronizar el expediente ${ev.entidad_id}: ` +
            "el entrenador no pertenece al gimnasio autenticado.",
        );
      }
      record.abierto_clave = record.abierto_clave == null
        ? null
        : `${gymId}:${trainerId}`;
    }

    if (
      ev.entidad === "entrenador_baja_decision" &&
      ev.operacion !== "DELETE"
    ) {
      const caseId = String(record.expediente_id ?? "");
      const membershipId = String(record.membresia_id ?? "");
      const targetTrainerId = String(record.id_entrenador_destino ?? "");
      const [expediente, membership, targetTrainer] = await Promise.all([
        caseId
          ? prisma.entrenadorBajaExpediente.findFirst({
              where: { expediente_id: caseId, gym_id: gymId, is_deleted: false },
              select: { expediente_id: true },
            })
          : null,
        membershipId
          ? prisma.membresiaCliente.findFirst({
              where: { membresia_id: membershipId, gym_id: gymId, is_deleted: false },
              select: { membresia_id: true },
            })
          : null,
        targetTrainerId
          ? prisma.entrenador.findFirst({
              where: {
                id_entrenador: targetTrainerId,
                gym_id: gymId,
                is_deleted: false,
              },
              select: { id_entrenador: true },
            })
          : true,
      ]);
      if (!expediente || !membership || !targetTrainer) {
        throw new Error(
          `No se puede sincronizar la decisión ${ev.entidad_id}: ` +
            "el expediente, la membresía o el entrenador destino no pertenece al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "entrenador_baja_comision_ajuste" &&
      ev.operacion !== "DELETE"
    ) {
      const caseId = String(record.expediente_id ?? "");
      const decisionId = String(record.decision_id ?? "");
      const membershipId = String(record.membresia_id ?? "");
      const installmentId = String(record.cuota_id ?? "");
      const originTrainerId = String(record.id_entrenador_origen ?? "");
      const targetTrainerId = String(record.id_entrenador_destino ?? "");
      const [offboardingCase, decision, membership, installment, origin, targetTrainer] =
        await Promise.all([
          caseId
            ? prisma.entrenadorBajaExpediente.findFirst({
                where: { expediente_id: caseId, gym_id: gymId, is_deleted: false },
                select: { expediente_id: true },
              })
            : null,
          decisionId
            ? prisma.entrenadorBajaDecision.findFirst({
                where: { decision_id: decisionId, gym_id: gymId, is_deleted: false },
                select: { decision_id: true, expediente_id: true, membresia_id: true },
              })
            : null,
          membershipId
            ? prisma.membresiaCliente.findFirst({
                where: { membresia_id: membershipId, gym_id: gymId, is_deleted: false },
                select: { membresia_id: true },
              })
            : null,
          installmentId
            ? prisma.entrenadorComisionCuota.findFirst({
                where: { cuota_id: installmentId, gym_id: gymId, is_deleted: false },
                select: { cuota_id: true },
              })
            : null,
          originTrainerId
            ? prisma.entrenador.findFirst({
                where: { id_entrenador: originTrainerId, gym_id: gymId },
                select: { id_entrenador: true },
              })
            : null,
          targetTrainerId
            ? prisma.entrenador.findFirst({
                where: { id_entrenador: targetTrainerId, gym_id: gymId },
                select: { id_entrenador: true },
              })
            : true,
        ]);
      if (
        !offboardingCase ||
        !decision ||
        decision.expediente_id !== caseId ||
        decision.membresia_id !== membershipId ||
        !membership ||
        !installment ||
        !origin ||
        !targetTrainer
      ) {
        throw new Error(
          `No se puede sincronizar el ajuste ${ev.entidad_id}: ` +
            "sus referencias no pertenecen al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "entrenador_liquidacion_aplicacion" &&
      ev.operacion !== "DELETE"
    ) {
      const settlementId = String(record.liquidacion_id ?? "");
      const installmentId = String(record.cuota_id ?? "");
      const [settlement, installment] = await Promise.all([
        settlementId
          ? prisma.entrenadorLiquidacion.findFirst({
              where: {
                liquidacion_id: settlementId,
                gym_id: gymId,
              },
              select: { liquidacion_id: true },
            })
          : null,
        installmentId
          ? prisma.entrenadorComisionCuota.findFirst({
              where: {
                cuota_id: installmentId,
                gym_id: gymId,
              },
              select: { cuota_id: true },
            })
          : null,
      ]);
      if (!settlement || !installment) {
        throw new Error(
          `No se puede sincronizar la aplicación ${ev.entidad_id}: ` +
            "la liquidación o la cuota no pertenece al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "entrenador_liquidacion_obligacion_aplicacion" &&
      ev.operacion !== "DELETE"
    ) {
      const settlementId = String(record.liquidacion_id ?? "");
      const obligationId = String(record.obligacion_id ?? "");
      const [settlement, obligation] = await Promise.all([
        settlementId
          ? prisma.entrenadorLiquidacion.findFirst({
              where: { liquidacion_id: settlementId, gym_id: gymId },
              select: { liquidacion_id: true },
            })
          : null,
        obligationId
          ? prisma.entrenadorObligacionFija.findFirst({
              where: { obligacion_id: obligationId, gym_id: gymId },
              select: { obligacion_id: true },
            })
          : null,
      ]);
      if (!settlement || !obligation) {
        throw new Error(
          `No se puede sincronizar la aplicación fija ${ev.entidad_id}: ` +
            "la liquidación o la obligación no pertenece al gimnasio autenticado.",
        );
      }
    }

    if (
      ev.entidad === "entrenador_liquidacion_reversion" &&
      ev.operacion !== "DELETE"
    ) {
      const settlementId = String(record.liquidacion_id ?? "");
      const settlement = settlementId
        ? await prisma.entrenadorLiquidacion.findFirst({
            where: {
              liquidacion_id: settlementId,
              gym_id: gymId,
            },
            select: { liquidacion_id: true },
          })
        : null;
      if (!settlement) {
        throw new Error(
          `No se puede sincronizar la reversión ${ev.entidad_id}: ` +
            "la liquidación no pertenece al gimnasio autenticado.",
        );
      }
    }

    if (ev.operacion === "DELETE") {
      const now = trustedClock.nowUtc();
      await target.delegate.updateMany({
        where: { [target.pk]: record[target.pk], gym_id: gymId },
        data: { is_deleted: true, deleted_at: now, updated_at: now },
      });
      return;
    }

    await target.delegate.upsert({
      where: { [target.pk]: record[target.pk] },
      create: record,
      update: record,
    });
  }

  private normalizeDates(payload: Record<string, unknown>) {
    for (const key of Object.keys(payload)) {
      const value = payload[key];
      if (
        typeof value === "string" &&
        (key.endsWith("_at") ||
          key.endsWith("_fecha") ||
          key.includes("_fecha_") ||
          key.startsWith("fecha_") ||
          key.startsWith("periodo_")) &&
        !Number.isNaN(Date.parse(value))
      ) {
        payload[key] = new Date(value);
      }
    }
    return payload;
  }
}
