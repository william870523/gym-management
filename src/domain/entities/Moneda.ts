export interface Moneda {
    moneda_id: string;
    moneda_nombre: string;
    codigo: string;
    simbolo?: string | null;
    imagen?: Uint8Array | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
