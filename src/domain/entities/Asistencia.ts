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
    /**
     * §5.2 — con qué se decidió la entrada de un **visitante**, congelado.
     * `null` en la de un socio de la casa: allí se decide con sus propias
     * membresías y no hay conocimiento ajeno que declarar.
     */
    decidido_con?: string | null;
    /** AL_DIA | CON_RETRASO | A_CIEGAS de quien decidió, no de la sede del socio. */
    conocimiento_al_decidir?: string | null;
    /** El hecho del que sale ese juicio. `null` si nunca se sincronizó. */
    dias_sin_noticias?: number | null;
    /**
     * Segundo eje: cuánto hacía que se sabía de la **sede del socio**.
     * `NO_CONSTA` cuando no se pudo medir, que no es estar al día.
     */
    conocimiento_origen_al_decidir?: string | null;
    dias_sin_noticias_origen?: number | null;
}
