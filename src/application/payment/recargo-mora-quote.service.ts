import { prisma } from "../../infrastructure/db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import {
    calcularDiasAtraso,
    normalizeRecargoMoraConfig,
    quoteRecargoMora,
    type RecargoMoraQuote,
} from "../../domain/recargo-mora-policy";

/**
 * Cotización autoritativa del recargo por mora (docs/RECARGO_MORA.md).
 *
 * Hermano del servicio local: la ventana de cobro web la consulta antes de
 * cobrar para mostrar días de atraso, base, recargo y total. Solo lectura.
 * El `gymId` viene del token, nunca del cuerpo o del query.
 */
export interface RecargoMoraQuoteInput {
    ci: string;
    planId: string;
    membresiaId?: string | null;
    numeroCuota?: number | null;
    aplicar?: boolean;
}

export interface RecargoMoraQuoteResult extends RecargoMoraQuote {
    plan_tiene_recargo: boolean;
    plan_recargo_activo: boolean;
    moneda_id: string;
    vencimiento: string | null;
}

export class RecargoMoraQuoteService {
    async quote(
        input: RecargoMoraQuoteInput,
        gymId: string,
    ): Promise<RecargoMoraQuoteResult> {
        const authenticatedGymId = gymId.trim();
        if (!authenticatedGymId) {
            throw new Error("El token debe identificar el gimnasio.");
        }

        const plan = await prisma.planesPago.findFirst({
            where: {
                id_planes_pago: input.planId,
                gym_id: authenticatedGymId,
                is_deleted: false,
            },
        });
        if (!plan) throw new Error(`Plan ${input.planId} no encontrado.`);

        const cliente = await prisma.cliente.findFirst({
            where: { ci: input.ci, gym_id: authenticatedGymId, is_deleted: false },
        });
        if (!cliente) throw new Error(`Cliente ${input.ci} no encontrado.`);

        const config = normalizeRecargoMoraConfig({
            modo: (plan as any).recargo_mora_modo,
            valor: (plan as any).recargo_mora_valor,
            tope: (plan as any).recargo_mora_tope,
            activo: (plan as any).recargo_mora_activo,
        });

        const today = trustedClock.nowUtc();
        let base = plan.importe_plan_pago;
        let dueDate: Date | null = (cliente as any).fecha_fin ?? null;

        const numero = Number(input.numeroCuota ?? 0);
        if (input.membresiaId && numero > 0) {
            const cuota = await (prisma as any).membresiaCuota.findFirst({
                where: {
                    membresia_id: input.membresiaId,
                    numero_cuota: numero,
                    gym_id: authenticatedGymId,
                    is_deleted: false,
                },
            });
            if (!cuota) {
                throw new Error(`La cuota ${numero} no existe para esta membresía.`);
            }
            base = Number(cuota.importe);
            dueDate = cuota.fecha_exigible;
        }

        const quote = quoteRecargoMora({
            baseAmount: base.toFixed(2),
            diasAtraso: calcularDiasAtraso(today, dueDate),
            aplicar: input.aplicar ?? true,
            config,
        });

        return {
            ...quote,
            plan_tiene_recargo: config != null,
            plan_recargo_activo: config?.activo ?? false,
            moneda_id: plan.moneda_id,
            vencimiento: dueDate ? dueDate.toISOString() : null,
        };
    }
}
