import type { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { datePartsInZone } from "../../config/tz";
import { trustedClock } from "../../config/trusted-clock";
import { splitCommissionInstallmentAtDate } from "../../domain/trainer-offboarding-policy";
import { serialize } from "../../shared/utils/serialize";
import { resolveRemotePaymentActor } from "../payment/payment-actor";

type Tx = Prisma.TransactionClient;

/** Dispositivo lógico de las escrituras que llegan por la web. */
const REMOTE_DEVICE = "WEB_ADMIN";

export class TrainerChangeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "TrainerChangeError";
  }
}

/**
 * R5.4 — Cambio de entrenador a petición del cliente, **desde la web**.
 *
 * Gemelo exacto de
 * `gym-local-api/src/application/membership/trainer-change.service.ts`: mismas
 * validaciones, mismos mensajes, mismos códigos HTTP y —sobre todo— el mismo
 * reparto de comisiones, porque reutiliza la política compartida
 * `splitCommissionInstallmentAtDate` de offboarding. **No se reimplementa el
 * reparto**: dos fórmulas para la misma regla es lo que prohíbe el manual.
 *
 * Tres cosas cambian respecto al local, y solo tres:
 *
 * 1. **El gimnasio sale del token**, nunca del cuerpo. Va como parámetro
 *    explícito y acota TODAS las consultas.
 * 2. **El ejecutor se revalida contra la base** (contrato R5.6): tiene que ser
 *    un `User` activo del gimnasio autenticado. La web no puede afirmar quién
 *    es.
 * 3. **Los eventos van a `sync_log`**, no a `sync_outbox`, y dentro de la misma
 *    transacción que el cambio.
 */
export class RemoteMembershipTrainerChangeService {
  /**
   * R5.4 — qué pasaría si se confirmara el cambio, **sin escribir nada**.
   *
   * Gemela de la del local. Existe porque el diálogo tiene que enseñar el
   * efecto financiero antes de confirmar y la regla dura del proyecto es que
   * **el servidor calcula el dinero y Flutter solo presenta**: calcularlo en el
   * cliente habría dado dos fórmulas para el mismo reparto, y encima una de
   * ellas en Dart.
   *
   * Comparte con `change()` la selección de cuotas y la política de reparto, así
   * que no puede desviarse de lo que el cambio hará de verdad.
   */
  async preview(
    tx: Tx,
    input: { gymId: string; membershipId: string; newTrainerId: string | null },
  ) {
    const plan = await this.planificar(tx, input.gymId, input);
    let ganado = 0;
    let futuro = 0;
    let transferibles = 0;
    let anulables = 0;

    for (const installment of plan.installments) {
      const monto = Math.round(Number(installment.monto) * 100);
      if (installment.periodo_inicio.getTime() < plan.effectiveDate.getTime()) {
        const split = splitCommissionInstallmentAtDate({
          amountMinor: monto,
          periodStart: installment.periodo_inicio,
          periodEnd: installment.periodo_fin,
          effectiveDate: plan.effectiveDate,
        });
        ganado += split.earnedMinor;
        futuro += split.futureMinor;
        if (split.futureMinor > 0) {
          if (plan.newTrainerId) transferibles += 1;
          else anulables += 1;
        }
      } else {
        futuro += monto;
        if (plan.newTrainerId) transferibles += 1;
        else anulables += 1;
      }
    }

    return {
      membresia_id: plan.membership.membresia_id,
      fecha_efectiva: plan.effectiveDate.toISOString().slice(0, 10),
      entrenador_anterior: plan.oldTrainerName,
      entrenador_nuevo: plan.newTrainerName,
      sin_entrenador: plan.newTrainerId === null,
      tramo_ganado: (ganado / 100).toFixed(2),
      tramo_futuro: (futuro / 100).toFixed(2),
      cuotas_transferibles: transferibles,
      cuotas_anulables: anulables,
      credito_liberado: plan.newTrainerId ? "0.00" : (futuro / 100).toFixed(2),
    };
  }

  async change(
    tx: Tx,
    input: {
      gymId: string;
      membershipId: string;
      newTrainerId: string | null;
      reason?: string | null;
      userId: string;
    },
  ) {
    const gymId = input.gymId;
    // R5.6: quién ejecuta se decide en la base, no en el cuerpo de la petición.
    // Si la identidad no se puede resolver, el error sale con su propio estado
    // (401/403/503) y el cambio no llega a empezar.
    const actor = await resolveRemotePaymentActor(tx as never, {
      userId: input.userId,
      gymId,
    });

    const now = trustedClock.nowUtc();
    const {
      effectiveDate,
      membership,
      oldTrainerId,
      newTrainerId,
      oldTrainerName,
      newTrainerName,
      installments,
    } = await this.planificar(tx, gymId, input);

    // 1. Asignaciones: cerrar la vigente, abrir la nueva.
    const current = await tx.membresiaEntrenadorAsignacion.findFirst({
      where: {
        membresia_id: membership.membresia_id,
        gym_id: gymId,
        estado: { in: ["PENDIENTE", "ACTIVA"] },
        is_deleted: false,
      },
    });
    if (current) {
      const closed = await tx.membresiaEntrenadorAsignacion.update({
        where: { asignacion_id: current.asignacion_id },
        data: {
          estado: "CERRADA",
          fecha_fin: effectiveDate,
          motivo_cierre: input.reason?.trim() || null,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.enqueue(tx, gymId, "membresia_entrenador_asignacion", closed.asignacion_id, closed);
    }
    if (newTrainerId) {
      const opened = await tx.membresiaEntrenadorAsignacion.create({
        data: {
          asignacion_id: crypto.randomUUID(),
          membresia_id: membership.membresia_id,
          id_entrenador: newTrainerId,
          fecha_inicio: effectiveDate,
          fecha_fin: null,
          estado: "ACTIVA",
          motivo_cierre: null,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          gym_id: gymId,
          source_device: REMOTE_DEVICE,
          version: 1,
          deleted_at: null,
        },
      });
      await this.enqueue(tx, gymId, "membresia_entrenador_asignacion", opened.asignacion_id, opened);
    }

    // 2. Proyección en membresía y cliente.
    const updatedMembership = await tx.membresiaCliente.update({
      where: { membresia_id: membership.membresia_id },
      data: {
        id_entrenador: newTrainerId,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    await this.enqueue(tx, gymId, "membresia_cliente", updatedMembership.membresia_id, updatedMembership);
    const updatedClient = await tx.cliente.update({
      where: { ci: membership.ci },
      data: { id_entrenador: newTrainerId, version: { increment: 1 }, updated_at: now },
    });
    await this.enqueue(tx, gymId, "cliente", updatedClient.ci, updatedClient);

    // 3. Comisiones del saliente: lo ganado se queda; el futuro se transfiere
    //    (o se anula si el cliente sigue sin entrenador).
    let transferred = 0;
    let cancelled = 0;
    if (oldTrainerId) {
      {
        for (const installment of installments) {
          const startsBefore = installment.periodo_inicio.getTime() < effectiveDate.getTime();
          if (startsBefore) {
            const split = splitCommissionInstallmentAtDate({
              amountMinor: Math.round(Number(installment.monto) * 100),
              periodStart: installment.periodo_inicio,
              periodEnd: installment.periodo_fin,
              effectiveDate,
            });
            const trimmed = await tx.entrenadorComisionCuota.update({
              where: { cuota_id: installment.cuota_id },
              data: {
                monto: split.earnedMinor / 100,
                periodo_fin: effectiveDate,
                estado: split.earnedMinor === 0 ? "ANULADO" : "PENDIENTE",
                notas: "Prorrateada por cambio de entrenador a petición del cliente",
                version: { increment: 1 },
                updated_at: now,
              },
            });
            await this.enqueue(tx, gymId, "entrenador_comision_cuota", trimmed.cuota_id, trimmed);
            if (split.futureMinor > 0 && newTrainerId) {
              const destination = await tx.entrenadorComisionCuota.create({
                data: {
                  cuota_id: crypto.randomUUID(),
                  devengo_id: installment.devengo_id,
                  id_entrenador: newTrainerId,
                  moneda_id: installment.moneda_id,
                  periodo_inicio: effectiveDate,
                  periodo_fin: installment.periodo_fin,
                  fecha_programada: installment.fecha_programada,
                  monto: split.futureMinor / 100,
                  estado: "PENDIENTE",
                  fecha_pago: null,
                  cuenta_id: null,
                  notas: "Tramo recibido por cambio de entrenador a petición del cliente",
                  is_deleted: false,
                  created_at: now,
                  gym_id: gymId,
                  source_device: REMOTE_DEVICE,
                  version: 1,
                  updated_at: now,
                  deleted_at: null,
                },
              });
              await this.enqueue(tx, gymId, "entrenador_comision_cuota", destination.cuota_id, destination);
              transferred += 1;
            } else if (split.futureMinor > 0) {
              cancelled += 1;
            }
          } else if (newTrainerId) {
            const moved = await tx.entrenadorComisionCuota.update({
              where: { cuota_id: installment.cuota_id },
              data: {
                id_entrenador: newTrainerId,
                notas: "Transferida por cambio de entrenador a petición del cliente",
                version: { increment: 1 },
                updated_at: now,
              },
            });
            await this.enqueue(tx, gymId, "entrenador_comision_cuota", moved.cuota_id, moved);
            transferred += 1;
          } else {
            const voided = await tx.entrenadorComisionCuota.update({
              where: { cuota_id: installment.cuota_id },
              data: {
                estado: "ANULADO",
                notas: "Anulada: el cliente continúa sin entrenador",
                version: { increment: 1 },
                updated_at: now,
              },
            });
            await this.enqueue(tx, gymId, "entrenador_comision_cuota", voided.cuota_id, voided);
            cancelled += 1;
          }
        }
      }
    }

    // 4. Aviso informativo para administración (sin aprobación previa). Nace en
    //    ESTA transacción: si el cambio se revierte, el aviso no queda huérfano.
    const mensaje =
      `El socio ${membership.ci} cambió de entrenador en «${membership.plan_nombre_snapshot}»: ` +
      `${oldTrainerName ?? "sin entrenador"} → ${newTrainerName ?? "sin entrenador"}.` +
      (input.reason?.trim() ? ` Motivo: ${input.reason.trim()}.` : "");
    const aviso = await tx.avisoAdministracion.create({
      data: {
        aviso_id: crypto.randomUUID(),
        gym_id: gymId,
        tipo: "CAMBIO_ENTRENADOR",
        referencia_id: membership.membresia_id,
        mensaje,
        actor_user_id: actor.userId,
        actor_nombre: actor.nombre ?? null,
        leido: false,
        is_deleted: false,
        created_at: now,
        source_device: REMOTE_DEVICE,
        version: 1,
        updated_at: now,
        deleted_at: null,
      },
    });
    await this.enqueue(tx, gymId, "aviso_administracion", aviso.aviso_id, aviso);

    return {
      membresia_id: membership.membresia_id,
      entrenador_anterior: oldTrainerName,
      entrenador_nuevo: newTrainerName,
      cuotas_transferidas: transferred,
      cuotas_anuladas: cancelled,
      aviso_id: aviso.aviso_id,
      fecha_efectiva: effectiveDate.toISOString().slice(0, 10),
    };
  }

  /**
   * Todo lo que hay que **leer y validar** antes de decidir un cambio. Gemelo
   * del planificador local, acotado por el gimnasio del token.
   *
   * Lo comparten `change()` y `preview()` a propósito: si cada uno hiciera sus
   * consultas, el diálogo podría enseñar un reparto y el servidor aplicar otro,
   * que es la clase de desajuste que nadie reporta como error porque las dos
   * cifras parecen razonables por separado.
   */
  private async planificar(
    tx: Tx,
    gymId: string,
    input: { membershipId: string; newTrainerId: string | null },
  ) {
    const gym = await tx.gym.findUnique({
      where: { gym_id: gymId },
      select: { timezone: true },
    });
    const parts = datePartsInZone(gym?.timezone ?? "Etc/UTC", trustedClock.nowUtc());
    const effectiveDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

    const membership = await tx.membresiaCliente.findFirst({
      where: { membresia_id: input.membershipId, gym_id: gymId, is_deleted: false },
    });
    // Una membresía de otra sede responde igual que una inexistente: el 404 no
    // debe filtrar que existe en algún sitio.
    if (!membership) {
      throw new TrainerChangeError("La membresía no existe.", 404);
    }
    if (!["ACTIVA", "PAUSADA", "PENDIENTE"].includes(membership.estado)) {
      throw new TrainerChangeError(
        "Solo una membresía vigente puede cambiar de entrenador.",
      );
    }
    const oldTrainerId = membership.id_entrenador ?? null;
    const newTrainerId = input.newTrainerId ?? null;
    if (oldTrainerId === newTrainerId) {
      throw new TrainerChangeError("El entrenador indicado ya es el actual.", 409);
    }
    let newTrainerName: string | null = null;
    if (newTrainerId) {
      const trainer = await tx.entrenador.findFirst({
        where: { id_entrenador: newTrainerId, gym_id: gymId, is_deleted: false },
      });
      if (!trainer || !trainer.activo_entrenador) {
        throw new TrainerChangeError("El entrenador destino no está activo.", 404);
      }
      newTrainerName = `${trainer.nombres_entrenador} ${trainer.apellidos_entrenador}`.trim();
    }
    const oldTrainer = oldTrainerId
      ? await tx.entrenador.findFirst({
          where: { id_entrenador: oldTrainerId, gym_id: gymId },
        })
      : null;
    const oldTrainerName = oldTrainer
      ? `${oldTrainer.nombres_entrenador} ${oldTrainer.apellidos_entrenador}`.trim()
      : null;

    let installments: any[] = [];
    if (oldTrainerId) {
      const applications = await tx.pagoMembresiaAplicacion.findMany({
        where: { membresia_id: membership.membresia_id, gym_id: gymId, is_deleted: false },
        select: { pago_cliente_id: true },
      });
      const paymentIds = applications.map((row) => row.pago_cliente_id);
      const accruals = await tx.entrenadorComisionDevengo.findMany({
        where: {
          OR: [
            { membresia_id: membership.membresia_id },
            ...(paymentIds.length ? [{ pago_cliente_id: { in: paymentIds } }] : []),
          ],
          id_entrenador: oldTrainerId,
          gym_id: gymId,
          is_deleted: false,
          estado: { not: "ANULADO" },
        },
        select: { devengo_id: true },
      });
      if (accruals.length) {
        installments = await tx.entrenadorComisionCuota.findMany({
          where: {
            devengo_id: { in: accruals.map((row) => row.devengo_id) },
            id_entrenador: oldTrainerId,
            gym_id: gymId,
            is_deleted: false,
            estado: { not: "ANULADO" },
            periodo_fin: { gt: effectiveDate },
          },
          orderBy: [{ periodo_inicio: "asc" }, { cuota_id: "asc" }],
        });
        for (const installment of installments) {
          if (installment.estado !== "PENDIENTE") {
            // También lo lanza la previsualización, y hace bien: el diálogo
            // tiene que enterarse de que no puede seguir ANTES de confirmar.
            throw new TrainerChangeError(
              "Existe una cuota futura pagada o parcial del entrenador saliente. Requiere un ajuste manual antes del cambio.",
              409,
            );
          }
        }
      }
    }

    return {
      effectiveDate,
      membership,
      oldTrainerId,
      newTrainerId,
      oldTrainerName,
      newTrainerName,
      installments,
    };
  }

  /**
   * Gemelo del `enqueue` local, con la única diferencia que impone la
   * arquitectura: el remoto registra en `sync_log` con su gimnasio y su
   * dispositivo, y el local en `sync_outbox`.
   */
  private async enqueue(
    tx: Tx,
    gymId: string,
    entidad: string,
    entidadId: string,
    payload: unknown,
  ) {
    await tx.syncLog.create({
      data: {
        event_id: crypto.randomUUID(),
        entidad,
        operacion: "UPDATE",
        entidad_id: entidadId,
        gym_id: gymId,
        device_id: REMOTE_DEVICE,
        payload_json: JSON.stringify(serialize(payload)),
      },
    });
  }
}
