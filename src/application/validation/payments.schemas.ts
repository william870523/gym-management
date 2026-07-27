import { z } from "zod";

// --- PagoCliente ---
export const PagoClienteSchema = z.object({
    pago_cliente_id: z.string().optional(),
    ci: z.string().min(1, "CI es requerido"),
    fecha: z.string().or(z.date()).transform((val) => new Date(val)),
    monto_total: z.number().min(0),
    id_entrenador: z.string().optional().nullable(),
    id_planes_pago: z.string().min(1, "Plan de pago es requerido"),
    moneda_id: z.string().min(1, "Moneda es requerida"),
    is_deleted: z.boolean().optional(),
    created_at: z.date().optional(),
    version: z.number().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreatePagoClienteSchema = PagoClienteSchema.omit({ pago_cliente_id: true, is_deleted: true, created_at: true, updated_at: true, deleted_at: true, version: true });
export const UpdatePagoClienteSchema = PagoClienteSchema.partial();

// --- DetallePago ---
export const DetallePagoSchema = z.object({
    detalle_pago_id: z.string().optional(),
    pago_cliente_id: z.string().min(1, "Pago Cliente ID es requerido"),
    tipo_pago_id: z.string().min(1, "Tipo Pago ID es requerido"),
    moneda_id: z.string().min(1, "Moneda ID es requerida"),
    cuenta_id: z.string().optional().nullable(),
    cantidad: z.number().min(0),
    tipo_cambio_id: z.string().min(1, "Tipo Cambio ID es requerido"),
    is_deleted: z.boolean().optional(),
    created_at: z.date().optional(),
    version: z.number().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateDetallePagoSchema = DetallePagoSchema.omit({ detalle_pago_id: true, is_deleted: true, created_at: true, updated_at: true, deleted_at: true, version: true });
export const UpdateDetallePagoSchema = DetallePagoSchema.partial();
