import type { PagoCliente } from "../entities/PagoCliente";

import type { DetallePago } from "../entities/DetallePago";
import type { PlanesPago } from "../entities/PlanesPago";

export interface PagoClienteRepository {
    upsertPagoCliente(data: PagoCliente): Promise<void>;
    findAll(): Promise<PagoCliente[]>;
    findById(id: string): Promise<PagoCliente | null>;
    create(data: PagoCliente): Promise<void>;
    update(id: string, data: Partial<PagoCliente>): Promise<void>;
    softDelete(id: string): Promise<void>;
    processPayment(
        pago: PagoCliente,
        detalles: DetallePago[],
        plan: PlanesPago,
        membershipId?: string | null,
    ): Promise<void>;
}
