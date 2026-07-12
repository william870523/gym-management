export interface Cuenta {
    cuenta_id: string;
    nombre_cuenta: string;
    moneda_id: string;
    tipo_pago_id?: string | null;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
    moneda?: any;
}
