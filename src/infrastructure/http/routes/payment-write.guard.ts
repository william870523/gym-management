import type { Context } from "hono";

export const PAYMENT_WRITE_GONE_CODE = "PAYMENT_WRITE_ROUTE_GONE";

/**
 * Payment writes must pass through the coordinated application services.
 * Keeping this response in one place prevents a future compatibility route
 * from silently reintroducing raw CRUD over financial records.
 */
export function paymentWriteGone(c: Context) {
    return c.json(
        {
            error: "Esta ruta de escritura fue retirada porque no coordina membresía, Tesorería, comisiones ni sincronización.",
            code: PAYMENT_WRITE_GONE_CODE,
            replacements: {
                process_payment: "POST /pagos/process",
                reverse_payment: "POST /pagos/:id/reversar",
            },
        },
        410,
    );
}
