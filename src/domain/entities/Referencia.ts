export interface Referencia {
    referencia_id: string;
    nombre_referencia: string;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
