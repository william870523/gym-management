export interface Entrenador {
    id_entrenador: string;
    ci_entrenador: string;
    tipo_documento: string;
    nombres_entrenador: string;
    apellidos_entrenador: string;
    sexo_entrenador: string;
    foto_entrenador?: Uint8Array | null;
    direccion_entrenador?: string | null;
    telefono_entrenador?: number | null;
    correo_entrenador?: string | null;
    activo_entrenador: boolean;
    fecha_incio_entrenador: Date;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
