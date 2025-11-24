export interface Asistencia {
    asistencia_id: string;
    ci: string;
    gym_id?: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
