import {
  calculateUnusedMembershipValue,
  OffboardingFinancialPolicyError,
} from "../../domain/trainer-offboarding-financial-policy";
import { formatDateOnly } from "../../domain/retention/retention-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { MembershipPauseService } from "./membership-pause.service";

export class VoluntaryCancellationPreviewError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function buildVoluntaryCancellationPreview(input: {
  clientId: string; clientName: string; membershipId: string; planName: string;
  state: string; currencyId: string; currencyCode?: string | null;
  currencySymbol?: string | null; paid: number; durationDays: number;
  start: Date; endExclusive: Date; businessToday: Date;
  pausedRemainingDays?: number | null;
}) {
  const state = input.state.trim().toUpperCase();
  if (!["ACTIVA", "PAUSADA", "PENDIENTE_PAGO"].includes(state)) {
    throw new VoluntaryCancellationPreviewError(
      state === "CANCELADA"
        ? "La membresía ya está cancelada."
        : "Esta membresía no admite una valoración de cancelación voluntaria.",
    );
  }
  let valuation;
  try {
    valuation = calculateUnusedMembershipValue({
      paidMinor: Math.round(input.paid * 100),
      durationDays: input.durationDays,
      start: input.start,
      endExclusive: input.endExclusive,
      effectiveDate: input.businessToday,
      membershipState: state,
      pausedRemainingDays: input.pausedRemainingDays,
    });
  } catch (error) {
    if (error instanceof OffboardingFinancialPolicyError) {
      throw new VoluntaryCancellationPreviewError(error.message, 400);
    }
    throw error;
  }
  const money = (minor: number) => minor / 100;
  return {
    fecha_efectiva: formatDateOnly(input.businessToday),
    socio: { ci: input.clientId, nombre: input.clientName },
    membresia: {
      id: input.membershipId, plan_nombre: input.planName, estado: state,
      moneda_id: input.currencyId, importe_pagado: money(valuation.paidMinor),
      moneda_codigo: input.currencyCode ?? null,
      moneda_simbolo: input.currencySymbol ?? null,
      fecha_inicio: formatDateOnly(input.start),
      fecha_fin_exclusiva: formatDateOnly(input.endExclusive),
    },
    valoracion: {
      metodo: valuation.method, dias_totales: valuation.durationDays,
      dias_consumidos: valuation.consumedDays,
      dias_restantes: valuation.remainingDays,
      importe_pagado: money(valuation.paidMinor),
      valor_consumido: money(valuation.consumedMinor),
      valor_no_consumido: money(valuation.unusedMinor),
    },
    alternativas: [
      { tipo: "CREDITO_CLIENTE", importe: money(valuation.unusedMinor), mueve_caja: false,
        descripcion: "Conservar el valor no consumido como crédito interno." },
      { tipo: "REEMBOLSO_PENDIENTE", importe: money(valuation.unusedMinor), mueve_caja: false,
        requiere_tesoreria: true, descripcion: "Enviar una solicitud de devolución a Tesorería." },
    ],
    reglas: { solo_previsualizacion: false, cancela_membresia: true,
      mueve_dinero: false, decision_pendiente: null,
      credito_requiere_administracion: true,
      reembolso_crea_solicitud_tesoreria: true },
  };
}

export class VoluntaryCancellationPreviewService {
  private readonly membershipClock = new MembershipPauseService();

  async preview(gymId: string, clientId: string, membershipId: string) {
    const context = await this.membershipClock.operationContext(gymId);
    const membership = await prisma.membresiaCliente.findFirst({
      where: { membresia_id: membershipId, ci: clientId, gym_id: gymId, is_deleted: false },
    });
    if (!membership) throw new VoluntaryCancellationPreviewError("Membresía no encontrada.", 404);
    const client = await prisma.cliente.findFirst({
      where: { ci: clientId, gym_id: gymId, is_deleted: false },
      select: { nombres: true, apellidos: true },
    });
    if (!client) throw new VoluntaryCancellationPreviewError("Cliente no encontrado.", 404);
    const pause = membership.estado === "PAUSADA"
      ? await prisma.membresiaPausa.findUnique({
          where: { activa_clave: membership.membresia_id },
          select: { dias_restantes_snapshot: true },
        })
      : null;
    const currency = await prisma.moneda.findFirst({
      where: { moneda_id: membership.moneda_id, is_deleted: false },
      select: { codigo: true, simbolo: true },
    });
    return buildVoluntaryCancellationPreview({
      clientId, clientName: `${client.nombres} ${client.apellidos}`.trim(),
      membershipId, planName: membership.plan_nombre_snapshot,
      state: membership.estado, currencyId: membership.moneda_id,
      currencyCode: currency?.codigo, currencySymbol: currency?.simbolo,
      paid: Number(membership.importe_pagado), durationDays: membership.duracion_dias_snapshot,
      start: membership.fecha_inicio, endExclusive: membership.fecha_fin,
      businessToday: context.businessToday,
      pausedRemainingDays: pause?.dias_restantes_snapshot,
    });
  }
}
