export interface Asistencia {
    asistencia_id: string;
    ci: string;
    fecha_salida?: Date | null;
    gym_id?: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
    /** Pausa de permanencia: instante UTC de la pausa vigente (null = activo). */
    pausa_inicio?: Date | null;
    /** Milisegundos acumulados de pausas ya cerradas. */
    pausa_ms?: number;
}
