import type { DecimalValue } from "../money";

export interface DetallePago {
    detalle_pago_id: string;
    pago_cliente_id: string;
    tipo_pago_id: string;
    moneda_id: string;
    cuenta_id?: string | null;
    cantidad: DecimalValue;
    tipo_cambio_id?: string | null;
    recargo_metodo_base?: string | number | null;
    recargo_metodo_pct?: string | null;
    recargo_metodo_importe?: string | null;
    recargo_metodo_total?: string | null;
    recargo_metodo_politica?: string | null;
    recargo_metodo_tasa_version?: number | null;
    // Snapshot congelado del recargo por mora (docs/RECARGO_MORA.md).
    // Histórico anterior al recargo queda nulo (pre-recargo-mora).
    recargo_mora_modo_snapshot?: string | null;
    recargo_mora_dias_atraso?: number | null;
    recargo_mora_base?: string | null;
    recargo_mora_importe?: string | null;
    recargo_mora_plan_valor?: string | null;
    recargo_mora_plan_tope?: string | null;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
