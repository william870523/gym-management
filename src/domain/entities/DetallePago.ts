export interface DetallePago {
    detalle_pago_id: string;
    pago_cliente_id: string;
    tipo_pago_id: string;
    moneda_id: string;
    cuenta_id?: string | null;
    cantidad: number;
    tipo_cambio_id?: string | null;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
