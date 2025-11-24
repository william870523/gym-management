export interface Nacionalidad {
    nacionalidad_id: string;
    nacionalidad_nombre: string;
    codigo_iso: string;
    bandera?: Uint8Array | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
