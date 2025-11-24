export interface TipoCambio {
    tipo_cambio_id: string;
    moneda_id_base: string;
    moneda_id_target: string;
    exchange_rate: number;
    fecha_inicio: Date;
    fecha_expiracion?: Date | null;
    activo: boolean;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
