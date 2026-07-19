import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { detallePagoRoutes } from "./detalle_pago.routes";
import { pagoClienteRoutes } from "./pago_cliente.routes";
import {
    PAYMENT_WRITE_GONE_CODE,
    paymentWriteGone,
} from "./payment-write.guard";
import { paymentsRoutes } from "./payments.routes";

async function expectGone(app: Hono, path: string, method: string) {
    const response = await app.request(path, { method });
    const payload = await response.json();

    expect(response.status).toBe(410);
    expect(payload).toMatchObject({
        code: PAYMENT_WRITE_GONE_CODE,
        replacements: {
            process_payment: "POST /pagos/process",
            reverse_payment: "POST /pagos/:id/reversar",
        },
    });
}

describe("payment write route guard", () => {
    test("returns a stable migration response", async () => {
        const app = new Hono().all("/", paymentWriteGone);
        await expectGone(app, "/", "POST");
    });

    test("blocks every legacy payment and detail mutation under /payments", async () => {
        const app = new Hono().route("/payments", paymentsRoutes());

        for (const [path, method] of [
            ["/payments/pagos", "POST"],
            ["/payments/pagos/payment-id", "PUT"],
            ["/payments/pagos/payment-id", "DELETE"],
            ["/payments/detalles-pago", "POST"],
            ["/payments/detalles-pago/detail-id", "PUT"],
            ["/payments/detalles-pago/detail-id", "DELETE"],
        ]) {
            await expectGone(app, path, method);
        }
    });

    test("legacy reads refuse to query without an authenticated gym", async () => {
        const app = new Hono().route("/payments", paymentsRoutes());

        for (const path of [
            "/payments/pagos",
            "/payments/pagos/payment-id",
            "/payments/detalles-pago",
            "/payments/detalles-pago/detail-id",
        ]) {
            const response = await app.request(path);
            expect(response.status).toBe(403);
        }
    });

    test("blocks raw create and update on both modern payment aliases", async () => {
        const app = new Hono()
            .route("/pagos", pagoClienteRoutes)
            .route("/pagos-cliente", pagoClienteRoutes);

        for (const prefix of ["/pagos", "/pagos-cliente"]) {
            await expectGone(app, prefix, "POST");
            await expectGone(app, `${prefix}/payment-id`, "PUT");
        }
    });

    test("does not intercept coordinated processing or reversal routes", async () => {
        const app = new Hono().route("/pagos", pagoClienteRoutes);

        const process = await app.request("/pagos/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });
        const reverse = await app.request("/pagos/payment-id/reversar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });
        const compatibleDelete = await app.request("/pagos/payment-id", {
            method: "DELETE",
        });

        expect(process.status).toBe(403);
        expect(reverse.status).toBe(403);
        expect(compatibleDelete.status).toBe(403);
    });

    test("blocks direct detail mutations outside the legacy prefix", async () => {
        const app = new Hono().route("/detalles-pago", detallePagoRoutes);

        await expectGone(app, "/detalles-pago", "POST");
        await expectGone(app, "/detalles-pago/detail-id", "PUT");
        await expectGone(app, "/detalles-pago/detail-id", "DELETE");
    });
});
