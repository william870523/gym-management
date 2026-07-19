import { randomUUID } from "crypto";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { CreatePagoClienteDTO } from "../../dtos/PagoClienteDTO";
import type { CreateDetallePagoDTO } from "../../dtos/DetallePagoDTO";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { DetallePago } from "../../../domain/entities/DetallePago";
import { trustedClock } from "../../../config/trusted-clock";
import { isFullPayment } from "../../../domain/membership-policy";

export interface ProcessPaymentInput extends CreatePagoClienteDTO {
    detalles: Omit<CreateDetallePagoDTO, 'pago_cliente_id'>[];
    membresia_id?: string | null;
}

export class ProcessPaymentUseCase {
    constructor(
        private readonly pagoClienteRepository: PagoClienteRepository,
        private readonly planesPagoRepository: PlanesPagoRepository
    ) { }

    async execute(input: ProcessPaymentInput): Promise<PagoCliente> {
        const occurredAt = trustedClock.nowUtc();
        // 1. Get Plan Duration
        const plan = await this.planesPagoRepository.findById(input.id_planes_pago);
        if (!plan) {
            throw new Error(`Plan con ID ${input.id_planes_pago} no encontrado.`);
        }
        if (!plan.activo || plan.is_deleted) {
            throw new Error(`El plan ${input.id_planes_pago} no está disponible.`);
        }
        if (!isFullPayment(input.monto_total, plan.importe_plan_pago)) {
            throw new Error(
                `El cobro completo requiere ${plan.importe_plan_pago.toFixed(2)} ${plan.moneda_id}.`,
            );
        }

        const pagoId = input.pago_cliente_id ?? randomUUID();

        // 2. Prepare Pago Entity
        const pago: PagoCliente = {
            pago_cliente_id: pagoId,
            ci: input.ci,
            // El servidor fija el instante; la zona del gimnasio solo se usa al mostrar.
            fecha: occurredAt,
            // El encabezado representa el precio aplicado al plan. Si recepción
            // recibe efectivo de más, el cambio se modelará como salida de caja.
            monto_total: plan.importe_plan_pago,
            id_entrenador: input.id_entrenador ?? null,
            id_planes_pago: input.id_planes_pago,
            moneda_id: input.moneda_id,
            gym_id: input.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: occurredAt,
            updated_at: occurredAt,
            deleted_at: null,
            is_deleted: false
        };

        // 3. Prepare Detalles Entities
        const detalles: DetallePago[] = input.detalles.map(d => ({
            detalle_pago_id: randomUUID(),
            pago_cliente_id: pagoId,
            tipo_pago_id: d.tipo_pago_id,
            moneda_id: d.moneda_id,
            cuenta_id: d.cuenta_id ?? null,
            cantidad: d.cantidad,
            tipo_cambio_id: d.tipo_cambio_id ?? null,
            gym_id: d.gym_id ?? input.gym_id ?? null, // Use detail's gym_id or fallback to payment's
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
        );

        return pago;
    }
}
