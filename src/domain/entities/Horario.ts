export interface Horario {
    horario_id: string;
    nombre_horario: string;
    hora_inicio: number;
    hora_fin: number;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
