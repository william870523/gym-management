export interface ClientePeso {
    cliente_peso_id: string;
    ci: string;
    fecha: Date;
    peso: number;
    gym_id?: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
