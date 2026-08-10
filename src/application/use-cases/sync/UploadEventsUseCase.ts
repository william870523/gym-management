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
import { frozenActorIsValid } from "../../accounting/frozen-actor";
import { createHash, randomUUID } from "crypto";
import { datePartsInZone } from "../../../config/tz";
import { reconcileFutureMembershipCoverage } from "../../../domain/membership-coverage-reconciliation";
import {
  PARITY_SYNC_ENTITIES,
  PARITY_SYNC_TARGET_DEFINITIONS,
  GLOBAL_SYNC_ENTITIES,
  assertSyncPrimaryKeyOwnership,
  buildAuthenticatedSyncPayload,
  buildAuthoritativeGymRecord,
  normalizeSyncDates,
  optionalSyncVersion,
  requireMappedSyncTarget,
  requireSyncEntityId,
  requireSyncOperation,
  requireSyncPrimaryKey,
  validateMembershipInstallmentSyncRecord,
  validatePlanInstallmentSyncRecord,
} from "./sync-event-contract";
import type {
  SyncTransactionContext,
  SyncTransactionRunner,
} from "./sync-transaction";
import { delegateFor } from "./sync-transaction";

/**
 * Resultado explícito del upload — Unidad 01, paso 4.
 *
 * `processed` se conserva como valor DERIVADO (número de eventos aplicados)
 * para no romper consumidores antiguos, pero no es autoridad: el cliente local
 * solo puede marcar como enviados los IDs que aparecen en `accepted_event_ids`
 * y `duplicate_event_ids`.
 */
export interface UploadEventsResult {
  accepted_event_ids: string[];
  duplicate_event_ids: string[];
  failed_event_id: string | null;
  processed: number;
}

type ApplyOutcome = "APPLIED" | "DUPLICATE";

export async function reconcileMembershipCoverageInRemoteTransaction(input: {
  tx: SyncTransactionContext;
  gymId: string;
  ci: string;
  deviceId: string;
  syncLogRepository: SyncLogRepository;
}): Promise<number> {
  const { tx, gymId, ci, deviceId, syncLogRepository } = input;
  const client: any = tx;
  const gym = await client.gym.findUnique({
    where: { gym_id: gymId },
    select: { timezone: true },
  });
  const parts = datePartsInZone(
    String(gym?.timezone ?? "Etc/UTC"),
    trustedClock.nowUtc(),
  );
  const businessToday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const memberships = await client.membresiaCliente.findMany({
    where: {
      gym_id: gymId,
      ci,
      is_deleted: false,
      estado: { in: ["PENDIENTE", "ACTIVA"] },
      fecha_fin: { gt: businessToday },
    },
    select: {
      membresia_id: true,
      fecha_inicio: true,
      fecha_fin: true,
      activada_at: true,
      estado: true,
      is_deleted: true,
      id_entrenador: true,
      importe_pagado: true,
      precio_snapshot: true,
    },
  });
  const reconciliation = reconcileFutureMembershipCoverage({
    businessToday,
    memberships: memberships.map((membership: any) => ({
      membershipId: String(membership.membresia_id),
      start: new Date(membership.fecha_inicio),
      endExclusive: new Date(membership.fecha_fin),
      activatedAt: membership.activada_at ? new Date(membership.activada_at) : null,
      state: String(membership.estado),
      isDeleted: Boolean(membership.is_deleted),
      trainerId: membership.id_entrenador ? String(membership.id_entrenador) : null,
      paidAmount: Number(membership.importe_pagado),
      contractedPrice: Number(membership.precio_snapshot),
    })),
  });
  if (reconciliation.corrections.length === 0) return 0;

  const membershipIds = reconciliation.orderedMembershipIds;
  const unsafeCounts = await Promise.all([
    client.membresiaPausa.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
    client.membresiaSolicitud.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
    client.membresiaEntrenadorAsignacion.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
    client.membresiaCuota.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
    client.entrenadorComisionDevengo.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
    client.membresiaAjusteFinanciero.count({
      where: {
        is_deleted: false,
        OR: [
          { membresia_origen_id: { in: membershipIds } },
          { membresia_destino_id: { in: membershipIds } },
        ],
      },
    }),
    client.creditoMembresiaAplicacion.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
    client.clienteReembolsoTesoreria.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
    client.pagoReversion.count({ where: { membresia_id: { in: membershipIds }, is_deleted: false } }),
  ]);
  if (unsafeCounts.some((count) => Number(count) > 0)) {
    throw new Error(
      "La cobertura concurrente tiene cuotas, pausas o efectos financieros; requiere conciliación supervisada.",
    );
  }

  const now = trustedClock.nowUtc();
  for (const correction of reconciliation.corrections) {
    const updated = await client.membresiaCliente.update({
      where: { membresia_id: correction.membershipId },
      data: {
        fecha_inicio: correction.start,
        fecha_fin: correction.endExclusive,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    await syncLogRepository.register(
      {
        eventId: randomUUID(),
        entidad: "membresia_cliente",
        operacion: "UPDATE",
        entidadId: updated.membresia_id,
        gymId,
        deviceId,
        payload: updated,
      },
      tx,
    );
  }

  const lastId = reconciliation.orderedMembershipIds[
    reconciliation.orderedMembershipIds.length - 1
  ]!;
  const lastMembership = await client.membresiaCliente.findUnique({
    where: { membresia_id: lastId },
  });
  if (!lastMembership) {
    throw new Error("No se pudo proyectar la última cobertura conciliada.");
  }
  const projectedClient = await client.cliente.updateMany({
    where: { ci, gym_id: gymId, is_deleted: false },
    data: {
      activo: true,
      id_planes_pago: lastMembership.id_planes_pago,
      id_entrenador: lastMembership.id_entrenador,
      fecha_inicio: lastMembership.fecha_inicio,
      fecha_fin: lastMembership.fecha_fin,
      version: { increment: 1 },
      updated_at: now,
    },
  });
  if (projectedClient.count !== 1) {
    throw new Error("No se pudo proyectar la cobertura dentro del gimnasio autenticado.");
  }
  const updatedClient = await client.cliente.findFirst({
    where: { ci, gym_id: gymId, is_deleted: false },
  });
  if (!updatedClient) {
    throw new Error("No se encontró al cliente después de proyectar su cobertura.");
  }
  const nationality = await client.nacionalidad.findUnique({
    where: { nacionalidad_id: updatedClient.nacionalidad_id },
    select: { codigo_iso: true },
  });
  await syncLogRepository.register(
    {
      eventId: randomUUID(),
      entidad: "cliente",
      operacion: "UPDATE",
      entidadId: ci,
      gymId,
      deviceId,
      payload: {
        ...updatedClient,
        ...(nationality ? { nacionalidad_codigo_iso: nationality.codigo_iso } : {}),
      },
    },
    tx,
  );
  return reconciliation.corrections.length;
}

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
    /**
     * Ejecutor transaccional. Último parámetro y opcional a propósito: así los
     * puntos de construcción existentes no cambian y los tests pueden inyectar
     * un doble que modela el rollback.
     */
    private readonly runInTransaction: SyncTransactionRunner = ((fn: any) =>
      prisma.$transaction(fn)) as SyncTransactionRunner,
  ) {}

  async execute(dto: UploadEventsDTO): Promise<UploadEventsResult> {
    const { device_id, gym_id, events } = dto;
    const acceptedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    let failedEventId: string | null = null;

    for (const ev of events) {
      try {
        const outcome = await this.runInTransaction((tx) =>
          this.applyEventAtomically(ev, gym_id, device_id, tx),
        );
        if (outcome === "DUPLICATE") {
          duplicateEventIds.push(ev.event_id);
        } else {
          acceptedEventIds.push(ev.event_id);
        }
      } catch (err) {
        // Un evento fallido detiene el lote: los posteriores no se procesan y
        // siguen pendientes en el outbox del cliente local.
        logger.error("Evento de sync fallido; se detiene el lote", {
          event_id: ev.event_id,
          entidad: ev.entidad,
          operacion: ev.operacion,
          entidad_id: ev.entidad_id,
          err,
        });
        failedEventId = ev.event_id;
        break;
      }
    }

    // Telemetría posterior al commit: su falla no puede deshacer ni fingir
    // eventos ya confirmados (Unidad 01, paso 5).
    await this.touchSyncClientState(device_id);

    return {
      accepted_event_ids: acceptedEventIds,
      duplicate_event_ids: duplicateEventIds,
      failed_event_id: failedEventId,
      processed: acceptedEventIds.length,
    };
  }

  /**
   * Unidad transaccional del upload: validación, mutación de la entidad y
   * registro en `sync_log`, todo con el mismo `tx`.
   */
  private async applyEventAtomically(
    ev: UploadEventsDTO["events"][number],
    gym_id: string,
    device_id: string,
    tx: SyncTransactionContext,
  ): Promise<ApplyOutcome> {
      requireSyncOperation(ev.operacion, ev.entidad);
      requireSyncEntityId(ev.entidad_id, ev.entidad);

      // Idempotencia: verificar si ya existe, con el mismo tx.
      const exists = await this.syncLogRepository.exists(ev.event_id, tx);
      if (exists) {
        return "DUPLICATE";
      }

      let effectivePayload = {
        ...(ev.payload as Record<string, unknown>),
      };
      if (ev.entidad === "cliente") {
        effectivePayload = await this.canonicalizeClientReferences(
          effectivePayload,
          tx,
        );
      }
      effectivePayload = buildAuthenticatedSyncPayload({
        entity: ev.entidad,
        payload: effectivePayload,
        gymId: gym_id,
        deviceId: device_id,
      });

      // Enrutamiento por entidad
      if (ev.entidad === "cliente") {
        await this.applyClienteEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "user") {
        await this.applyUserEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "gym") {
        await this.applyGymEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "cliente_peso") {
        await this.applyClientePesoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "asistencia") {
        await this.applyAsistenciaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "pago_cliente") {
        await this.applyPagoClienteEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "detalle_pago") {
        await this.applyDetallePagoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "moneda") {
        await this.applyMonedaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "nacionalidad") {
        await this.applyNacionalidadEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "tipo_pago") {
        await this.applyTipoPagoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "tipo_cambio") {
        await this.applyTipoCambioEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "referencia") {
        await this.applyReferenciaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "horario") {
        await this.applyHorarioEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "planes_pago") {
        await this.applyPlanesPagoEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "cuenta") {
        await this.applyCuentaEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
        });
      } else if (ev.entidad === "entrenador") {
        await this.applyEntrenadorEventUseCase.execute({
          eventId: ev.event_id,
          entidadId: ev.entidad_id,
          operacion: ev.operacion,
          gymId: gym_id,
          deviceId: device_id,
          payload: effectivePayload,
          tx,
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
          "tesoreria_cierre_periodo",
          "membresia_cliente",
          "membresia_pausa",
          "membresia_solicitud",
          "retencion_gestion",
          "membresia_entrenador_asignacion",
          "pago_membresia_aplicacion",
          "pago_reversion",
          // E0-b: catálogo de motivos de baja (PLAN_ESTADISTICAS.md §7-ter).
          "motivo_baja",
          "gasto_categoria",
          "gasto_proveedor",
          "gasto_gobernado",
          "gasto_gobernado_aplicacion",
          "gasto_recurrente",
          "plan_cuota_esquema",
          "membresia_cuota",
          "aviso_administracion",
        ].includes(ev.entidad)
      ) {
        await this.applyPrismaMappedEvent(
          { ...ev, payload: effectivePayload },
          gym_id,
          device_id,
          tx,
        );
      } else {
        logger.error("Entidad de sync no implementada en UploadEventsUseCase", {
          entidad: ev.entidad,
          operacion: ev.operacion,
          entidad_id: ev.entidad_id,
        });
        throw new Error(`Entidad de sync no soportada: ${ev.entidad}.`);
      }

      // Un DELETE local incrementa `version` antes de encolarse. El remoto
      // debe congelar esa misma versión dentro de esta transacción; de lo
      // contrario, la fila queda borrada en ambos lados pero con huellas
      // distintas (PD-4). Los modelos del mapper genérico se atienden dentro
      // de applyPrismaMappedEvent; aquí cubrimos los handlers dedicados.
      if (ev.operacion === "DELETE") {
        await this.applyDedicatedDeleteVersion({
          entity: ev.entidad,
          entityId: ev.entidad_id,
          gymId: gym_id,
          payload: effectivePayload,
          tx,
        });
      }

      const effectiveGymId = GLOBAL_SYNC_ENTITIES.has(ev.entidad)
        ? null
        : gym_id;

      // Registrar en sync_log, con el mismo tx que escribió la entidad.
      await this.syncLogRepository.register(
        {
          eventId: ev.event_id,
          entidad: ev.entidad,
          operacion: ev.operacion,
          entidadId: ev.entidad_id,
          gymId: effectiveGymId,
          deviceId: device_id,
          payload: effectivePayload,
        },
        tx,
      );

      // El evento original se registra primero. Si la unión local/remota
      // descubre dos compras futuras solapadas, las correcciones quedan después
      // en el cursor y ningún cliente puede sobrescribirlas con el payload viejo.
      if (ev.entidad === "membresia_cliente" && ev.operacion !== "DELETE") {
        const ci = String(effectivePayload.ci ?? "").trim();
        if (!ci) {
          throw new Error("La membresía sincronizada no identifica al cliente.");
        }
        await reconcileMembershipCoverageInRemoteTransaction({
          tx,
          gymId: gym_id,
          ci,
          deviceId: device_id,
          syncLogRepository: this.syncLogRepository,
        });
      }

      return "APPLIED";
  }

  private async applyDedicatedDeleteVersion(input: {
    entity: string;
    entityId: string;
    gymId: string;
    payload: Record<string, unknown>;
    tx: SyncTransactionContext;
  }) {
    const client: any = input.tx;
    const mapping: Record<
      string,
      { delegate: any; pk: string; global?: boolean }
    > = {
      cliente: { delegate: client.cliente, pk: "ci" },
      user: { delegate: client.user, pk: "user_id" },
      cliente_peso: { delegate: client.clientePeso, pk: "cliente_peso_id" },
      asistencia: { delegate: client.asistencia, pk: "asistencia_id" },
      pago_cliente: { delegate: client.pagoCliente, pk: "pago_cliente_id" },
      detalle_pago: { delegate: client.detallePago, pk: "detalle_pago_id" },
      moneda: { delegate: client.moneda, pk: "moneda_id", global: true },
      nacionalidad: {
        delegate: client.nacionalidad,
        pk: "nacionalidad_id",
        global: true,
      },
      tipo_pago: { delegate: client.tipoPago, pk: "tipo_pago_id", global: true },
      tipo_cambio: {
        delegate: client.tipoCambio,
        pk: "tipo_cambio_id",
        global: true,
      },
      referencia: {
        delegate: client.referencia,
        pk: "referencia_id",
        global: true,
      },
      horario: { delegate: client.horario, pk: "horario_id" },
      planes_pago: { delegate: client.planesPago, pk: "id_planes_pago" },
      cuenta: { delegate: client.cuenta, pk: "id_cuenta" },
      entrenador: { delegate: client.entrenador, pk: "id_entrenador" },
    };
    const target = mapping[input.entity];
    // `gym` no tiene columna version y las entidades genéricas ya se
    // actualizaron en applyPrismaMappedEvent.
    if (!target) return;

    const version = optionalSyncVersion(input.payload, input.entity);
    if (version === undefined) return;

    const where: Record<string, unknown> = { [target.pk]: input.entityId };
    if (!target.global) where.gym_id = input.gymId;
    await target.delegate.updateMany({ where, data: { version } });
  }

  /** Telemetría del dispositivo. Fuera de la transacción por evento. */
  private async touchSyncClientState(device_id: string) {
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
  }

  private async canonicalizeClientReferences(
    payload: Record<string, unknown>,
    tx?: SyncTransactionContext,
  ) {
    const incomingId = String(payload.nacionalidad_id ?? "");
    const incomingCode = String(payload.nacionalidad_codigo_iso ?? "")
      .trim()
      .toUpperCase();
    // La validación de referencias lee por el mismo tx que escribe la entidad:
    // de otro modo comprobaría un estado distinto del que se está mutando.
    const nacionalidadDelegate = delegateFor(
      tx,
      "nacionalidad",
      prisma.nacionalidad,
    );
    const byId = incomingId
      ? await nacionalidadDelegate.findUnique({
          where: { nacionalidad_id: incomingId },
        })
      : null;
    const nationality =
      byId && !byId.is_deleted
        ? byId
        : incomingCode
          ? await nacionalidadDelegate.findUnique({
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
    tx?: SyncTransactionContext,
  ) {
    // Todo el camino genérico —delegados, validaciones de referencia y
    // comprobaciones de propiedad— usa el mismo cliente transaccional.
    const client: any = tx ?? prisma;
    const mapping: Record<string, { delegate: any; pk: string }> = {
      configuracion_sistema: {
        delegate: client.configuracionSistema,
        pk: "configuracion_id",
      },
      entrenador_comision_regla: {
        delegate: client.entrenadorComisionRegla,
        pk: "regla_id",
      },
      entrenador_compensacion_perfil: {
        delegate: client.entrenadorCompensacionPerfil,
        pk: "perfil_id",
      },
      entrenador_obligacion_fija: {
        delegate: client.entrenadorObligacionFija,
        pk: "obligacion_id",
      },
      entrenador_baja_expediente: {
        delegate: client.entrenadorBajaExpediente,
        pk: "expediente_id",
      },
      entrenador_baja_decision: {
        delegate: client.entrenadorBajaDecision,
        pk: "decision_id",
      },
      entrenador_baja_comision_ajuste: {
        delegate: client.entrenadorBajaComisionAjuste,
        pk: "ajuste_id",
      },
      membresia_ajuste_financiero: {
        delegate: client.membresiaAjusteFinanciero,
        pk: "ajuste_financiero_id",
      },
      cliente_credito: {
        delegate: client.clienteCredito,
        pk: "credito_id",
      },
      credito_membresia_aplicacion: {
        delegate: client.creditoMembresiaAplicacion,
        pk: "aplicacion_id",
      },
      cliente_reembolso_tesoreria: {
        delegate: client.clienteReembolsoTesoreria,
        pk: "reembolso_id",
      },
      cliente_reembolso_reversion: {
        delegate: client.clienteReembolsoReversion,
        pk: "reversion_id",
      },
      entrenador_comision_devengo: {
        delegate: client.entrenadorComisionDevengo,
        pk: "devengo_id",
      },
      entrenador_comision_cuota: {
        delegate: client.entrenadorComisionCuota,
        pk: "cuota_id",
      },
      entrenador_liquidacion: {
        delegate: client.entrenadorLiquidacion,
        pk: "liquidacion_id",
      },
      entrenador_liquidacion_aplicacion: {
        delegate: client.entrenadorLiquidacionAplicacion,
        pk: "aplicacion_id",
      },
      entrenador_liquidacion_obligacion_aplicacion: {
        delegate: client.entrenadorLiquidacionObligacionAplicacion,
        pk: "aplicacion_id",
      },
      entrenador_liquidacion_reversion: {
        delegate: client.entrenadorLiquidacionReversion,
        pk: "reversion_id",
      },
      tesoreria_operacion_manual: {
        delegate: client.tesoreriaOperacionManual,
        pk: "operacion_manual_id",
      },
      tesoreria_movimiento: {
        delegate: client.tesoreriaMovimiento,
        pk: "movimiento_id",
      },
      tesoreria_cierre: {
        delegate: client.tesoreriaCierre,
        pk: "cierre_id",
      },
      tesoreria_cierre_solicitud: {
        delegate: client.tesoreriaCierreSolicitud,
        pk: "solicitud_id",
      },
      tesoreria_conciliacion: {
        delegate: client.tesoreriaConciliacion,
        pk: "conciliacion_id",
      },
      tesoreria_cierre_mensual: {
        delegate: client.tesoreriaCierreMensual,
        pk: "cierre_mensual_id",
      },
      membresia_cliente: {
        delegate: client.membresiaCliente,
        pk: "membresia_id",
      },
      membresia_pausa: {
        delegate: client.membresiaPausa,
        pk: "pausa_id",
      },
      membresia_solicitud: {
        delegate: client.membresiaSolicitud,
        pk: "solicitud_id",
      },
      retencion_gestion: {
        delegate: client.retencionGestion,
        pk: "gestion_id",
      },
      // E0-b: catálogo de motivos de baja (PLAN_ESTADISTICAS.md §7-ter). Es por
      // sede, no global: cada gimnasio administra los suyos.
      motivo_baja: {
        delegate: client.motivoBaja,
        pk: "motivo_baja_id",
      },
      membresia_entrenador_asignacion: {
        delegate: client.membresiaEntrenadorAsignacion,
        pk: "asignacion_id",
      },
      pago_membresia_aplicacion: {
        delegate: client.pagoMembresiaAplicacion,
        pk: "aplicacion_id",
      },
      pago_reversion: {
        delegate: client.pagoReversion,
        pk: "reversion_id",
      },
      aviso_administracion: {
        delegate: client.avisoAdministracion,
        pk: "aviso_id",
      },
      ...Object.fromEntries(
        Object.entries(PARITY_SYNC_TARGET_DEFINITIONS).map(
          ([entityName, definition]) => [
            entityName,
            {
              delegate: client[definition.delegateKey],
              pk: definition.pk,
            },
          ],
        ),
      ),
    };
    const operation = requireSyncOperation(ev.operacion, ev.entidad);
    const target = requireMappedSyncTarget(mapping, ev.entidad);

    const payload = normalizeSyncDates({
      ...(ev.payload as Record<string, unknown>),
    });
    const primaryKey = requireSyncPrimaryKey({
      entity: ev.entidad,
      pk: target.pk,
      entityId: ev.entidad_id,
      payload,
    });
    const record: Record<string, unknown> = buildAuthoritativeGymRecord({
      payload,
      primaryKeyField: target.pk,
      primaryKey,
      // Gimnasio y origen vienen del JWT/DTO ya contrastado por el
      // controlador; el cuerpo del evento nunca puede suplantarlos.
      gymId,
      deviceId,
    });

    // Todas las entidades que llegan por el mapper son de gimnasio. La PK es
    // global en Prisma, pero jamás puede usarse para reasignar una fila de
    // otro tenant mediante un upsert.
    const existingOwnedRecord: { gym_id: string | null } | null =
      await target.delegate.findUnique({
        where: { [target.pk]: primaryKey },
        select: { gym_id: true },
      });
    assertSyncPrimaryKeyOwnership({
      entity: ev.entidad,
      primaryKey,
      gymId,
      existingRecord: existingOwnedRecord,
    });

    // R5.4 — convergencia del aviso de administración: **«leído» gana y nunca
    // retrocede**. Gemela de la regla del worker local. Sin ella, un aviso que
    // administración ya marcó como leído en la web volvía a aparecer pendiente
    // en cuanto subiera la copia del escritorio que aún lo tenía sin leer. Es
    // monótona a propósito: se puede marcar desde cualquiera de los dos lados y
    // el orden de llegada deja de importar.
    if (
      ev.entidad === "aviso_administracion" &&
      operation !== "DELETE" &&
      record.leido === false
    ) {
      const existente: { leido: boolean } | null = await target.delegate.findUnique({
        where: { [target.pk]: primaryKey },
        select: { leido: true },
      });
      if (existente?.leido) record.leido = true;
    }

    if (ev.entidad === "configuracion_sistema" && operation !== "DELETE") {
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
      if (operation === "DELETE") {
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
      // Unidad 09 — quien firma el cierre viaja congelado (nombre, rol y
      // origen). Exigir fila en `User` rechazaba todo cierre firmado desde una
      // cuenta local del escritorio, que es el caso normal en una sede.
      const closer = closerId
        ? frozenActorIsValid({
            userId: closerId,
            origen: record.cerrado_por_origen,
          })
        : null;
      const reopener = reopenerId
        ? frozenActorIsValid({
            userId: reopenerId,
            origen: record.reabierto_por_origen,
          })
        : null;
      const existing = await client.tesoreriaCierreMensual.findUnique({
        where: { cierre_mensual_id: ev.entidad_id },
      });
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
        (operation === "INSERT" && state !== "CERRADO") ||
        (operation === "UPDATE" && !existing) ||
        Boolean(immutableConflict)
      ) {
        throw new Error(
          `No se puede sincronizar el cierre mensual ${ev.entidad_id}: ` +
            "la firma, el período, los actores o la fotografía auditada no son válidos.",
        );
      }
    }

    if (ev.entidad === "tesoreria_cierre_periodo") {
      if (operation === "DELETE") {
        throw new Error("Un cierre por período auditado no se puede eliminar por sincronización.");
      }
      const type = String(record.tipo_periodo ?? "").trim().toUpperCase();
      const state = String(record.estado ?? "").trim().toUpperCase();
      const start = new Date(String(record.fecha_inicio ?? ""));
      const endExclusive = new Date(String(record.fecha_fin_exclusiva ?? ""));
      const snapshotJson = String(record.snapshot_json ?? "");
      const expectedHash = createHash("sha256").update(snapshotJson).digest("hex");
      let snapshot: any = null;
      try { snapshot = JSON.parse(snapshotJson); } catch { snapshot = null; }
      const closerId = String(record.cerrado_por_user_id ?? "").trim();
      const existing = await client.tesoreriaCierrePeriodo.findUnique({
        where: { cierre_periodo_id: ev.entidad_id },
      });
      const key = record.clave_periodo_activa == null
        ? null
        : String(record.clave_periodo_activa);
      const expectedKey = Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())
        ? ""
        : `${gymId}|${type}|${start.toISOString().slice(0, 10)}|${endExclusive.toISOString().slice(0, 10)}`;
      const immutableConflict = existing && (
        existing.gym_id !== gymId ||
        existing.tipo_periodo !== type ||
        existing.operacion_id !== String(record.operacion_id ?? "") ||
        existing.motivo_cierre !== String(record.motivo_cierre ?? "") ||
        existing.snapshot_json !== snapshotJson ||
        existing.snapshot_sha256 !== String(record.snapshot_sha256 ?? "") ||
        existing.cerrado_por_user_id !== closerId ||
        existing.fecha_inicio.getTime() !== start.getTime() ||
        existing.fecha_fin_exclusiva.getTime() !== endExclusive.getTime()
      );
      const validReopen = state === "REABIERTO"
        ? Boolean(record.reapertura_operacion_id && record.reapertura_motivo &&
            record.reabierto_por_user_id && record.reabierto_por_nombre_snapshot &&
            record.reabierto_por_rol_snapshot && record.reabierto_at)
        : record.reapertura_operacion_id == null;
      if (
        !["DIARIO", "SEMANAL", "PERSONALIZADO"].includes(type) ||
        !["CERRADO", "REABIERTO"].includes(state) ||
        Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime()) ||
        endExclusive.getTime() <= start.getTime() ||
        (state === "CERRADO" ? key !== expectedKey : key != null) ||
        !validReopen || !closerId || !record.cerrado_por_nombre_snapshot ||
        !record.cerrado_por_rol_snapshot || !snapshot ||
        snapshot.gym_id !== gymId || snapshot.tipo_periodo !== type ||
        snapshot.fecha_inicio !== start.toISOString().slice(0, 10) ||
        snapshot.fecha_fin_exclusiva !== endExclusive.toISOString().slice(0, 10) ||
        snapshot.cerrado_por?.user_id !== closerId ||
        expectedHash !== String(record.snapshot_sha256 ?? "") ||
        (operation === "INSERT" && state !== "CERRADO") ||
        (operation === "UPDATE" && !existing) || Boolean(immutableConflict)
      ) {
        throw new Error(
          `No se puede sincronizar el cierre por período ${ev.entidad_id}: ` +
            "tenant, rango, actor, ciclo o firma no válidos.",
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
      operation !== "DELETE"
    ) {
      const businessDate = new Date(String(record.fecha_negocio ?? ""));
      if (!Number.isNaN(businessDate.getTime())) {
        const month = businessDate.toISOString().slice(0, 7);
        const monthlyLock = await client.tesoreriaCierreMensual.findFirst({
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

    if (ev.entidad === "membresia_cliente" && operation !== "DELETE") {
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
      operation !== "DELETE"
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

    if (ev.entidad === "entrenador_liquidacion" && operation !== "DELETE") {
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
      operation !== "DELETE"
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
      // Unidad 09 — quien solicita y quien decide el arqueo viajan congelados,
      // por el mismo motivo que el cierre mensual: en una sede ambos suelen ser
      // cuentas locales que nunca tendrán fila aquí.
      const requester = requesterId
        ? frozenActorIsValid({
            userId: requesterId,
            origen: record.solicitada_por_origen,
          })
        : null;
      const decider = deciderId
        ? frozenActorIsValid({
            userId: deciderId,
            origen: record.decidida_por_origen,
          })
        : null;
      const [movements, close] = await Promise.all([
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

    await this.validateParityEntityReferences(
      ev.entidad,
      String(primaryKey),
      record,
      gymId,
      operation,
      tx,
    );

    if (operation === "DELETE") {
      const now = trustedClock.nowUtc();
      const version = optionalSyncVersion(payload, ev.entidad);
      const deleted = await target.delegate.updateMany({
        where: { [target.pk]: record[target.pk], gym_id: gymId },
        data: {
          is_deleted: true,
          deleted_at: now,
          updated_at: now,
          ...(version === undefined ? {} : { version }),
        },
      });
      if (existingOwnedRecord && deleted.count !== 1) {
        throw new Error(
          `No se pudo eliminar ${ev.entidad} ${String(primaryKey)} ` +
            "dentro del gimnasio autenticado.",
        );
      }
      return;
    }

    if (existingOwnedRecord) {
      const updated = await target.delegate.updateMany({
        where: { [target.pk]: primaryKey, gym_id: gymId },
        data: record,
      });
      if (updated.count !== 1) {
        throw new Error(
          `No se pudo actualizar ${ev.entidad} ${String(primaryKey)} ` +
            "dentro del gimnasio autenticado.",
        );
      }
    } else {
      // create (en vez de upsert por PK global) evita que una carrera pueda
      // reasignar silenciosamente una fila perteneciente a otro gimnasio.
      await target.delegate.create({ data: record });
    }
  }

  private async validateParityEntityReferences(
    entity: string,
    entityId: string,
    record: Record<string, unknown>,
    gymId: string,
    operation: "INSERT" | "UPDATE" | "DELETE",
    tx?: SyncTransactionContext,
  ) {
    if (!PARITY_SYNC_ENTITIES.has(entity) || operation === "DELETE") return;

    // Las referencias se validan con el mismo cliente que escribe la entidad.
    const client: any = tx ?? prisma;

    if (entity === "gasto_categoria") {
      const nature = String(record.naturaleza ?? "").trim().toUpperCase();
      if (!["OPERATIVO", "ADMINISTRATIVO", "COSTO_VENTAS"].includes(nature)) {
        throw new Error(
          `No se puede sincronizar la categoría ${entityId}: naturaleza inválida.`,
        );
      }
      record.naturaleza = nature;
      return;
    }

    if (entity === "gasto_proveedor") {
      const accountId = String(record.cuenta_pago_default_id ?? "").trim();
      const account = accountId
        ? await client.cuenta.findFirst({
            where: { cuenta_id: accountId, gym_id: gymId },
            select: { cuenta_id: true },
          })
        : true;
      if (!account) {
        throw new Error(
          `No se puede sincronizar el proveedor ${entityId}: ` +
            "la cuenta predeterminada no pertenece al gimnasio autenticado.",
        );
      }
      return;
    }

    if (entity === "gasto_gobernado" || entity === "gasto_recurrente") {
      const categoryId = String(record.categoria_id ?? "").trim();
      const supplierId = String(record.proveedor_id ?? "").trim();
      const currencyId = String(record.moneda_id ?? "").trim();
      const recurringId = entity === "gasto_gobernado"
        ? String(record.recurrente_id ?? "").trim()
        : "";
      // Unidad 09 — el actor viaja congelado dentro del evento y se valida como
      // tal: identificador presente y origen de la lista canónica. Exigir fila
      // en `User` rechazaba todo gasto registrado desde una cuenta local del
      // escritorio, que es la mayoría, y lo dejaba atascado en el outbox
      // reintentando mientras la fila vivía solo en SQLite.
      const operator = entity === "gasto_gobernado"
        ? frozenActorIsValid({
            userId: record.registrada_por_user_id,
            origen: record.registrada_por_origen,
          })
        : true;
      const [category, supplier, currency, recurring] =
        await Promise.all([
          categoryId
            ? client.gastoCategoria.findFirst({
                where: { categoria_id: categoryId, gym_id: gymId },
                select: { categoria_id: true },
              })
            : null,
          supplierId
            ? client.gastoProveedor.findFirst({
                where: { proveedor_id: supplierId, gym_id: gymId },
                select: { proveedor_id: true },
              })
            : true,
          currencyId
            ? client.moneda.findFirst({
                where: { moneda_id: currencyId, is_deleted: false },
                select: { moneda_id: true },
              })
            : null,
          recurringId
            ? client.gastoRecurrente.findFirst({
                where: { recurrente_id: recurringId, gym_id: gymId },
                select: { recurrente_id: true },
              })
            : true,
        ]);
      if (!category || !supplier || !currency || !recurring) {
        throw new Error(
          `No se puede sincronizar ${entity} ${entityId}: ` +
            "categoría, proveedor, moneda o plantilla no pertenece al gimnasio autenticado.",
        );
      }
      if (!operator) {
        throw new Error(
          `No se puede sincronizar ${entity} ${entityId}: ` +
            "el actor que lo registró no viaja completo (falta identificador u origen válido).",
        );
      }

      const amount = Number(record.monto);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(
          `No se puede sincronizar ${entity} ${entityId}: importe inválido.`,
        );
      }

      const validMonth = (value: unknown) => {
        const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? "").trim());
        const month = match ? Number(match[2]) : 0;
        return Boolean(match && month >= 1 && month <= 12);
      };

      if (entity === "gasto_recurrente") {
        const day = Number(record.dia_programado);
        if (
          !validMonth(record.mes_inicio) ||
          (record.mes_fin != null && !validMonth(record.mes_fin)) ||
          !Number.isInteger(day) ||
          day < 1 ||
          day > 28 ||
          (record.mes_fin != null &&
            String(record.mes_fin) < String(record.mes_inicio))
        ) {
          throw new Error(
            `No se puede sincronizar la plantilla ${entityId}: vigencia o día programado inválido.`,
          );
        }
      } else {
        const state = String(record.estado ?? "").trim().toUpperCase();
        if (
          !validMonth(record.periodo_pertenencia_mes) ||
          !["PENDIENTE", "PARCIAL", "PAGADO", "ANULADO"].includes(state)
        ) {
          throw new Error(
            `No se puede sincronizar el gasto ${entityId}: período o estado inválido.`,
          );
        }
        record.estado = state;
        if (operation === "INSERT") {
          const month = String(record.periodo_pertenencia_mes);
          const monthlyLock = await client.tesoreriaCierreMensual.findFirst({
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
              `El período ${month} está cerrado; el gasto ${entityId} requiere reapertura.`,
            );
          }
        }
      }
      return;
    }

    if (entity === "gasto_gobernado_aplicacion") {
      const amount = Number(record.monto_aplicado);
      const state = String(record.estado ?? "").trim().toUpperCase();
      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !["APLICADA", "REVERSADA"].includes(state)
      ) {
        throw new Error(
          `No se puede sincronizar la aplicación ${entityId}: importe o estado inválido.`,
        );
      }
      record.estado = state;
      const expenseId = String(record.gasto_id ?? "").trim();
      const movementId = String(record.movimiento_id ?? "").trim();
      const [expense, movement] = await Promise.all([
        expenseId
          ? client.gastoGobernado.findFirst({
              where: { gasto_id: expenseId, gym_id: gymId },
              select: { gasto_id: true, moneda_id: true },
            })
          : null,
        movementId
          ? client.tesoreriaMovimiento.findFirst({
              where: { movimiento_id: movementId, gym_id: gymId },
              select: {
                movimiento_id: true,
                moneda_id: true,
                origen_tipo: true,
                origen_id: true,
                origen_detalle_id: true,
              },
            })
          : null,
      ]);
      if (
        !expense ||
        !movement ||
        movement.moneda_id !== expense.moneda_id ||
        movement.origen_tipo !== "GASTO_GOBERNADO" ||
        movement.origen_id !== expenseId ||
        movement.origen_detalle_id !== entityId
      ) {
        throw new Error(
          `No se puede sincronizar la aplicación ${entityId}: ` +
            "el gasto o el movimiento no pertenece al gimnasio autenticado.",
        );
      }
      return;
    }

    if (entity === "plan_cuota_esquema") {
      validatePlanInstallmentSyncRecord(record);
      const planId = String(record.plan_id ?? "").trim();
      const plan = planId
        ? await client.planesPago.findFirst({
            where: { id_planes_pago: planId, gym_id: gymId },
            select: { id_planes_pago: true },
          })
        : null;
      if (!plan) {
        throw new Error(
          `No se puede sincronizar el esquema ${entityId}: ` +
            "el plan no pertenece al gimnasio autenticado.",
        );
      }
      return;
    }

    if (entity === "membresia_cuota") {
      validateMembershipInstallmentSyncRecord(record);
      const membershipId = String(record.membresia_id ?? "").trim();
      const paymentDetailId = String(record.pago_detalle_id ?? "").trim();
      const [membership, paymentDetail] = await Promise.all([
        membershipId
          ? client.membresiaCliente.findFirst({
              where: { membresia_id: membershipId, gym_id: gymId },
              select: { membresia_id: true },
            })
          : null,
        paymentDetailId
          ? client.detallePago.findFirst({
              where: { detalle_pago_id: paymentDetailId, gym_id: gymId },
              select: { detalle_pago_id: true },
            })
          : true,
      ]);
      if (!membership || !paymentDetail) {
        throw new Error(
          `No se puede sincronizar la cuota ${entityId}: ` +
            "la membresía o el detalle de pago no pertenece al gimnasio autenticado.",
        );
      }
    }
  }

}
