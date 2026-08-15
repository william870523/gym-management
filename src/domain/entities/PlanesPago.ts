import type { DecimalInput, DecimalValue } from "../money";

export interface PlanesPago {
    id_planes_pago: string;
    nombre_plan_pago?: string | null;
    importe_plan_pago: DecimalValue;
    duracion_plan_pago: number;
    activo: boolean;
    moneda_id: string;
    incluye_entrenador?: boolean;
    comision_entrenador_tipo?: string;
    comision_entrenador_valor?: DecimalInput;
    // R5.2: indica si el plan admite pago por cuotas (deuda técnica alineada).
    acepta_cuotas?: boolean;
    // R5.3: código corto de recepción (PMV, TCN...). Campo libre.
    codigo?: string | null;
    // R5.3: precio fijo cliente VIEJO; null = aplicar % global.
    precio_viejo_excepcion?: DecimalInput;
    // Recargo por mora (docs/RECARGO_MORA.md). El administrador elige un modo
    // por plan; importes como string decimal. null/activo=false = sin recargo.
    recargo_mora_modo?: string | null;
    recargo_mora_valor?: string | null;
    recargo_mora_tope?: string | null;
    recargo_mora_activo?: boolean;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
