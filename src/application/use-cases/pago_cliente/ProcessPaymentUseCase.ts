import { randomUUID } from "crypto";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { CreatePagoClienteDTO } from "../../dtos/PagoClienteDTO";
import type { CreateDetallePagoDTO } from "../../dtos/DetallePagoDTO";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { DetallePago } from "../../../domain/entities/DetallePago";
import { trustedClock } from "../../../config/trusted-clock";
import { PaymentRuleError } from "../../../domain/payment-rule-error";
import { isFullPayment } from "../../../domain/membership-policy";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import {
    collectorColumns,
    PrismaPaymentActorResolver,
    type PaymentActorResolver,
} from "../../payment/payment-actor";
import { prisma } from "../../../infrastructure/db/prismaClient";
import {
    buildRecargoMoraCondonacion,
    calcularDiasAtraso,
    normalizeRecargoMoraConfig,
    quoteRecargoMora,
    type RecargoMoraQuote,
} from "../../../domain/recargo-mora-policy";
import { resolveClientDiscountQuote } from "../../payment/client-discount-quote.service";
import type { ClientDiscountQuote } from "../../payment/client-discount-quote.service";

export type ClientDiscountQuoteResolver = (
    input: { gymId: string; ci: string; planId: string },
) => Promise<ClientDiscountQuote>;

export interface ProcessPaymentInput extends CreatePagoClienteDTO {
    detalles: Omit<CreateDetallePagoDTO, 'pago_cliente_id'>[];
    membresia_id?: string | null;
    /**
     * Condonación del recargo por mora (docs/RECARGO_MORA.md §6-bis). El
     * recargo se aplica siempre que corresponda; perdonarlo exige motivo.
     */
    condonar_recargo_mora?: boolean;
    motivo_condonacion_recargo?: string;
    /**
     * R5.2 — cobro por cuotas: `true` contrata/activa con la cuota 1 o, con
     * `numero_cuota > 1`, paga esa cuota de la membresía indicada.
     */
    modo_cuotas?: boolean;
    numero_cuota?: number | null;
}

export class ProcessPaymentUseCase {
    constructor(
        private readonly pagoClienteRepository: PagoClienteRepository,
        private readonly planesPagoRepository: PlanesPagoRepository,
        /** Opcional: sin él no se puede medir el atraso y no se aplica recargo. */
        private readonly clienteRepository?: ClienteRepository,
        /**
         * R5.6 — resuelve al cobrador contra la base. Se inyecta para poder
         * sustituirlo; por defecto usa el cliente Prisma de la instalación.
         */
        private readonly actorResolver: PaymentActorResolver =
            new PrismaPaymentActorResolver(prisma),
        private readonly discountQuoteResolver: ClientDiscountQuoteResolver =
            (input) => resolveClientDiscountQuote(prisma, input),
    ) { }

    async execute(
        input: ProcessPaymentInput,
        gymId: string,
        actorUserId?: string | null,
    ): Promise<PagoCliente> {
        const occurredAt = trustedClock.nowUtc();
        const authenticatedGymId = gymId.trim();
        if (!authenticatedGymId) {
            throw new Error("El token debe identificar el gimnasio del pago.");
        }
        // R5.6 — quién recibe el dinero se revalida contra la base antes de
        // tocar nada, y falla cerrado: sin actor válido no hay pago, ni
        // membresía, ni movimiento (docs/PAYMENT_COLLECTOR_ATTRIBUTION.md §9).
        const actor = await this.actorResolver.resolve({
            userId: actorUserId,
            gymId: authenticatedGymId,
        });
        // 1. Get Plan Duration
        const plan = await this.planesPagoRepository.findById(input.id_planes_pago, authenticatedGymId);
        if (!plan) {
            throw new PaymentRuleError(`Plan con ID ${input.id_planes_pago} no encontrado.`);
        }
        if (!plan.activo || plan.is_deleted) {
            throw new PaymentRuleError(`El plan ${input.id_planes_pago} no está disponible.`);
        }
        // Recargo por mora (docs/RECARGO_MORA.md): la base es el precio del
        // plan y el atraso se mide contra el fin de cobertura del cliente. El
        // cobro debe cubrir base + recargo.
        const moraConfig = normalizeRecargoMoraConfig({
            modo: (plan as any).recargo_mora_modo,
            valor: (plan as any).recargo_mora_valor,
            tope: (plan as any).recargo_mora_tope,
            activo: (plan as any).recargo_mora_activo,
        });
        // R5.2 — por cuotas, el importe exigido y el recargo dependen de la
        // cuota real, así que se resuelven DENTRO de la transacción del cobro
        // (repositorio). Aquí no se cotiza ni se valida contra el plan entero:
        // hacerlo fuera abriría una ventana para cobrar dos veces la misma
        // cuota entre la consulta y la escritura.
        const porCuotas = Boolean(input.modo_cuotas);
        const numeroCuota = Number(input.numero_cuota ?? 0);
        // Cotización temprana para responder con un error claro. El repositorio
        // vuelve a resolverla dentro de la transacción antes de escribir.
        const discountQuote = porCuotas
            ? null
            : await this.discountQuoteResolver({
                gymId: authenticatedGymId,
                ci: input.ci,
                planId: input.id_planes_pago,
            });

        let moraQuote: RecargoMoraQuote | null = null;
        if (!porCuotas && moraConfig && this.clienteRepository) {
            const cliente = await this.clienteRepository.findById(
                input.ci, authenticatedGymId,
            );
            moraQuote = quoteRecargoMora({
                baseAmount: discountQuote!.precio_final,
                diasAtraso: calcularDiasAtraso(occurredAt, (cliente as any)?.fecha_fin),
                // El recargo siempre se cotiza; condonarlo es la excepción.
                aplicar: true,
                config: moraConfig,
            });
        }
        // Condonación: exige motivo y registra lo que se dejó de cobrar.
        const condonar = Boolean(input.condonar_recargo_mora);
        let condonacion: ReturnType<typeof buildRecargoMoraCondonacion> | null = null;
        if (condonar && !porCuotas) {
            if (!moraQuote?.aplicado) {
                throw new PaymentRuleError("No hay recargo por mora que condonar en este cobro.");
            }
            condonacion = buildRecargoMoraCondonacion({
                importeQueSeIbaACobrar: moraQuote.recargo,
                motivo: input.motivo_condonacion_recargo,
                condonadoPorUserId: actorUserId ?? null,
            });
        }
        const recargoMora = condonar ? 0 : Number(moraQuote?.recargo ?? 0);
        if (!porCuotas) {
            const requiredTotal = Number(discountQuote!.precio_final) + recargoMora;
            if (!isFullPayment(input.monto_total, requiredTotal)) {
                throw new PaymentRuleError(
                    `El cobro completo requiere ${requiredTotal.toFixed(2)} ${plan.moneda_id}` +
                    `${recargoMora > 0 ? ` (incluye recargo por mora ${moraQuote?.recargo})` : ""}.`,
                );
            }
        }
        const appliedMora = !condonar && moraQuote?.aplicado ? moraQuote : null;

        const pagoId = input.pago_cliente_id ?? randomUUID();

        // 2. Prepare Pago Entity
        const pago: PagoCliente = {
            pago_cliente_id: pagoId,
            ci: input.ci,
            // El servidor fija el instante; la zona del gimnasio solo se usa al mostrar.
            fecha: occurredAt,
            // El encabezado representa el precio aplicado al plan. Si recepción
            // recibe efectivo de más, el cambio se modelará como salida de caja.
            // Total cobrado = precio del plan + recargo por mora (desglosado
            // en el detalle; el recargo es ingreso aparte).
            monto_total:
                Number(discountQuote?.precio_final ?? plan.importe_plan_pago)
                + recargoMora,
            id_entrenador: input.id_entrenador ?? null,
            id_planes_pago: input.id_planes_pago,
            moneda_id: input.moneda_id,
            precio_lista_snapshot: Number(
                discountQuote?.precio_lista ?? plan.importe_plan_pago,
            ),
            descuento_pct_snapshot: discountQuote?.descuento_pct ?? null,
            descuento_monto_snapshot: Number(discountQuote?.descuento ?? 0),
            categoria_cliente_snapshot: discountQuote?.categoria_cliente ?? null,
            plan_codigo_snapshot:
                discountQuote?.plan_codigo
                ?? (String(plan.codigo ?? "").trim()
                    || String(plan.nombre_plan_pago ?? "").trim()
                    || plan.id_planes_pago),
            cuota_sufijo_snapshot: numeroCuota > 0 ? `/${numeroCuota}` : null,
            gym_id: authenticatedGymId,
            source_device: null,
            version: 1,
            created_at: occurredAt,
            updated_at: occurredAt,
            deleted_at: null,
            is_deleted: false,
            recargo_mora_condonado_importe: condonacion?.recargo_mora_condonado_importe ?? null,
            recargo_mora_condonado_motivo: condonacion?.recargo_mora_condonado_motivo ?? null,
            recargo_mora_condonado_por: condonacion?.recargo_mora_condonado_por ?? null,
            ...collectorColumns(actor),
        } as PagoCliente;

        // 3. Prepare Detalles Entities. El snapshot del recargo por mora
        // (docs/RECARGO_MORA.md) se congela aquí; null cuando no hubo recargo.
        const detalles: DetallePago[] = input.detalles.map(d => ({
            detalle_pago_id: randomUUID(),
            pago_cliente_id: pagoId,
            tipo_pago_id: d.tipo_pago_id,
            moneda_id: d.moneda_id,
            cuenta_id: d.cuenta_id ?? null,
            cantidad: d.cantidad,
            tipo_cambio_id: d.tipo_cambio_id ?? null,
            recargo_metodo_base: d.recargo_metodo_base ?? null,
            recargo_metodo_tasa_version: d.recargo_metodo_tasa_version ?? null,
            recargo_mora_modo_snapshot: appliedMora?.modo ?? null,
            recargo_mora_dias_atraso: appliedMora?.dias_atraso ?? null,
            recargo_mora_base: appliedMora?.base ?? null,
            recargo_mora_importe: appliedMora?.recargo ?? null,
            recargo_mora_plan_valor: appliedMora ? (moraConfig?.valor ?? null) : null,
            recargo_mora_plan_tope: appliedMora ? (moraConfig?.tope ?? null) : null,
            gym_id: authenticatedGymId,
            source_device: null,
            version: 1,
            created_at: occurredAt,
            updated_at: occurredAt,
            deleted_at: null,
            is_deleted: false
        }));

        // 4. Process Logic
        await this.pagoClienteRepository.processPayment(
            pago,
            detalles,
            plan,
            input.membresia_id,
            porCuotas
                ? {
                    numeroCuota: numeroCuota > 0 ? numeroCuota : null,
                    paidAmount: Number(input.monto_total),
                    condonarRecargoMora: condonar,
                    motivoCondonacionRecargo: input.motivo_condonacion_recargo ?? null,
                    condonadoPorUserId: actorUserId ?? null,
                }
                : null,
        );

        // Se devuelve la fila REALMENTE guardada, no la entidad que se armó
        // antes de la transacción: el importe definitivo lo fija el servidor
        // dentro del cobro (la cuota y su recargo, o el saldo del plan), así
        // que la entidad en memoria puede traer otro `monto_total` y la web
        // mostraría un importe que no se cobró.
        const persistido = await this.pagoClienteRepository.findById(
            pagoId,
            authenticatedGymId,
        );
        return persistido ?? pago;
    }
}
