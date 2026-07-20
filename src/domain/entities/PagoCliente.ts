export interface PagoCliente {
    pago_cliente_id: string;
    ci: string;
    fecha: Date;
    monto_total: number;
    id_entrenador?: string | null;
    id_planes_pago: string;
    moneda_id: string;
    // R5.3: snapshot del descuento aplicado al cobrar (cliente VIEJO). Null
    // cuando no hubo descuento (cliente NUEVO o sin descuento vigente).
    precio_lista_snapshot?: number | null;
    descuento_pct_snapshot?: string | null;
    descuento_monto_snapshot?: number | null;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
