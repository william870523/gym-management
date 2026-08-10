import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { PagoCliente } from "../entities/PagoCliente";

import type { DetallePago } from "../entities/DetallePago";
import type { PlanesPago } from "../entities/PlanesPago";

/**
 * R5.2 — intención de cobro por cuotas.
 *
 * El importe exigido y el recargo por mora NO viajan aquí: los calcula el
 * servidor dentro de la transacción del cobro, contra la cuota real. Así dos
 * peticiones simultáneas de la misma cuota no pueden cobrarse dos veces.
 */
export interface InstallmentPaymentIntent {
    /** `null` o 1 = contratación con la cuota 1; >1 = pago de esa cuota. */
    numeroCuota?: number | null;
    /** Lo que entrega el socio; el servidor valida contra base + recargo. */
    paidAmount: number;
    /** Condonación del recargo (docs/RECARGO_MORA.md §6-bis). */
    condonarRecargoMora?: boolean;
    motivoCondonacionRecargo?: string | null;
    /** Sale del token, nunca del cuerpo. */
    condonadoPorUserId?: string | null;
}

export interface PagoClienteRepository extends SyncTransactionalRepository<PagoClienteRepository> {
    upsertPagoCliente(data: PagoCliente): Promise<void>;
    findAll(gymId: string, skip?: number, take?: number): Promise<PagoCliente[]>;
    findById(id: string, gymId: string): Promise<PagoCliente | null>;
    create(data: PagoCliente): Promise<void>;
    update(id: string, gymId: string, data: Partial<PagoCliente>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
    processPayment(
        pago: PagoCliente,
        detalles: DetallePago[],
        plan: PlanesPago,
        membershipId?: string | null,
        installment?: InstallmentPaymentIntent | null,
    ): Promise<void>;
}
