export interface TipoPago {
    tipo_pago_id: string;
    nombre_tipo_pago: string;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
