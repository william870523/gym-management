export interface PlanesPago {
    id_planes_pago: string;
    nombre_plan_pago?: string | null;
    importe_plan_pago: number;
    duracion_plan_pago: number;
    activo: boolean;
    moneda_id: string;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
