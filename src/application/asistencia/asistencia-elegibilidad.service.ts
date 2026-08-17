import { prisma } from "../../infrastructure/db/prismaClient";
import { PlanInstallmentService } from "../membership/plan-installment.service";
import type { MembresiaParaEntrada } from "../../domain/asistencia-elegibilidad-policy";
import { trustedClock } from "../../config/trusted-clock";
import { datePartsInZone } from "../../config/tz";
import { env } from "../../config/env";

/**
 * Reúne los hechos que la política de entrada necesita, leyéndolos de MariaDB.
 *
 * Solo LEE y no decide nada: la decisión es de
 * `domain/asistencia-elegibilidad-policy.ts`, que es gemela de la del
 * escritorio. Separarlo así es lo que permite que una prueba compare las dos
 * reglas sin base de datos delante.
 */
export class AsistenciaElegibilidadService {
  constructor(private readonly client: any = prisma) {}

  /** ¿El socio tiene ya una entrada sin salida registrada en esta sede? */
  async tieneEntradaAbierta(ci: string, gymId: string): Promise<boolean> {
    const abierta = await this.client.asistencia.findFirst({
      where: { ci, gym_id: gymId, fecha_salida: null, is_deleted: false },
      select: { asistencia_id: true },
    });
    return Boolean(abierta);
  }

  /** Devuelve la entrada abierta, para poder responder con la misma fila. */
  async entradaAbierta(ci: string, gymId: string) {
    return this.client.asistencia.findFirst({
      where: { ci, gym_id: gymId, fecha_salida: null, is_deleted: false },
      orderBy: { created_at: "asc" },
    });
  }

  /** Fecha de negocio de la sede, no la del servidor (docs/TIME_CONTRACT.md). */
  async fechaDeNegocio(gymId: string): Promise<Date> {
    const gym = await this.client.gym.findUnique({
      where: { gym_id: gymId },
      select: { timezone: true },
    });
    const partes = datePartsInZone(
      gym?.timezone?.trim() || env.defaultGymTimezone,
      trustedClock.nowUtc(),
    );
    return new Date(Date.UTC(partes.year, partes.month - 1, partes.day));
  }

  /** ¿Es socio de esta sede? Si no, se le atiende por el camino del visitante. */
  async esSocioDeLaSede(ci: string, gymId: string): Promise<boolean> {
    const propio = await this.client.cliente.findFirst({
      where: { ci, gym_id: gymId, is_deleted: false },
      select: { ci: true },
    });
    return Boolean(propio);
  }

  /**
   * Copia de solo lectura y acceso multi-sede de un socio de otra sede (M4a).
   * Son los únicos datos suyos que la sede visitada tiene.
   */
  async visitante(ci: string) {
    const [copia, acceso] = await Promise.all([
      this.client.clienteVisitante.findFirst({
        where: { ci, is_deleted: false },
      }),
      this.client.clienteAccesoMultisede.findFirst({
        where: { ci, is_deleted: false },
      }),
    ]);
    return { copia, acceso };
  }

  /**
   * Membresías vivas del socio con su bloqueo por cuota ya resuelto contra el
   * día de negocio de la sede y la gracia configurada.
   */
  async membresiasParaEntrada(
    ci: string,
    gymId: string,
  ): Promise<MembresiaParaEntrada[]> {
    const membresias = await this.client.membresiaCliente.findMany({
      where: {
        ci,
        gym_id: gymId,
        is_deleted: false,
        estado: { in: ["ACTIVA", "PAUSADA", "PENDIENTE_PAGO"] },
      },
      select: { estado: true, membresia_id: true, fecha_fin: true },
    });

    const installmentService = new PlanInstallmentService();
    return Promise.all(
      membresias.map(async (membresia: any) => {
        if (membresia.estado !== "ACTIVA") {
          return {
            estado: membresia.estado,
            fechaFin: membresia.fecha_fin,
            bloqueoPorCuota: null,
          };
        }
        const acceso = await installmentService.evaluateAccess(this.client, {
          gymId,
          membershipId: membresia.membresia_id,
        });
        return {
          estado: membresia.estado,
          fechaFin: membresia.fecha_fin,
          bloqueoPorCuota: {
            bloqueada: acceso.hasQuotas && acceso.blocked,
            motivo: acceso.reason,
          },
        };
      }),
    );
  }
}
