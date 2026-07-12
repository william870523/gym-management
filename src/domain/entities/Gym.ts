export interface Gym {
    gym_id: string;
    codigo: string;
    nombre: string;
    direccion?: string | null;
    ciudad?: string | null;
    provincia?: string | null;
    pais?: string | null;
    codigo_postal?: string | null;
    timezone?: string | null;
    activo: boolean;
    created_at?: Date | null;
    updated_at: Date;
    deleted_at?: Date | null;
}
