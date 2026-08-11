import { prisma } from "../../infrastructure/db/prismaClient";
import { PlanInstallmentService } from "../membership/plan-installment.service";
import type { MembresiaParaEntrada } from "../../domain/asistencia-elegibilidad-policy";

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
      select: { estado: true, membresia_id: true },
    });

    const installmentService = new PlanInstallmentService();
    return Promise.all(
      membresias.map(async (membresia: any) => {
        if (membresia.estado !== "ACTIVA") {
          return { estado: membresia.estado, bloqueoPorCuota: null };
        }
        const acceso = await installmentService.evaluateAccess(this.client, {
          gymId,
          membershipId: membresia.membresia_id,
        });
        return {
          estado: membresia.estado,
          bloqueoPorCuota: {
            bloqueada: acceso.hasQuotas && acceso.blocked,
            motivo: acceso.reason,
          },
        };
      }),
    );
  }
}
