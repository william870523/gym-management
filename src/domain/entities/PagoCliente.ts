import type { DecimalInput, DecimalValue } from "../money";

export interface PagoCliente {
    pago_cliente_id: string;
    ci: string;
    fecha: Date;
    monto_total: DecimalValue;
    id_entrenador?: string | null;
    id_planes_pago: string;
    moneda_id: string;
    // R5.3: snapshot del descuento aplicado al cobrar (cliente VIEJO). Null
    // cuando no hubo descuento (cliente NUEVO o sin descuento vigente).
    precio_lista_snapshot?: DecimalInput;
    descuento_pct_snapshot?: string | null;
    descuento_monto_snapshot?: DecimalInput;
    categoria_cliente_snapshot?: string | null;
    plan_codigo_snapshot?: string | null;
    cuota_sufijo_snapshot?: string | null;
    // Condonación del recargo por mora (docs/RECARGO_MORA.md §6-bis).
    recargo_mora_condonado_importe?: string | null;
    recargo_mora_condonado_motivo?: string | null;
    recargo_mora_condonado_por?: string | null;
    // R5.6: quién recibió el dinero. Un cobro que llega por sincronización
    // conserva el actor congelado por la instalación que cobró; el dispositivo
    // que sube el evento no se convierte en recepcionista.
    cobrado_por_user_id?: string | null;
    cobrado_por_nombre_snapshot?: string | null;
    cobrado_por_rol_snapshot?: string | null;
    cobrado_por_origen?: string | null;
    gym_id: string | null;
    source_device?: string | null;
    version: number;
    created_at?: Date | null;
    updated_at?: Date;
    deleted_at?: Date | null;
    is_deleted?: boolean;
}
