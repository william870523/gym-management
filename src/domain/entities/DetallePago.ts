export interface DetallePago {
    detalle_pago_id: string;
    pago_cliente_id: string;
    tipo_pago_id: string;
    moneda_id: string;
    cuenta_id?: string | null;
    cantidad: number;
    tipo_cambio_id?: string | null;
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
