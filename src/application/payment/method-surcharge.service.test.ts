import { describe, expect, test } from "bun:test";
import { MethodSurchargeError, quoteMethodSurcharge } from "./method-surcharge.service";

function database(overrides: { rateVersion?: number; accountGym?: string; sitePct?: string } = {}) {
  return {
    cuenta: { findFirst: async ({ where }: any) =>
      where.gym_id === (overrides.accountGym ?? "gym-a")
        ? { cuenta_id: "account", gym_id: where.gym_id, moneda_id: "CUP", tipo_pago_id: "transfer" }
        : null },
    tipoPago: { findUnique: async () => ({ tipo_pago_id: "transfer", activo: true, is_deleted: false }) },
    tipoCambio: { findUnique: async () => ({
      tipo_cambio_id: "rate",
      moneda_id_base: "EUR",
      moneda_id_target: "CUP",
      exchange_rate: 450,
      recargos_json: '{"transfer":"5.00"}',
      fecha_inicio: new Date("2026-01-01T00:00:00.000Z"),
      fecha_expiracion: null,
      activo: true,
      is_deleted: false,
      version: overrides.rateVersion ?? 3,
    }) },
    tipoCambioRecargo: { findMany: async () => overrides.sitePct == null ? [] : [{
      tipo_cambio_recargo_id: "site-row", tipo_cambio_id: "rate",
      tipo_pago_id: "transfer", gym_id: "gym-a", porcentaje: overrides.sitePct,
      is_deleted: false, version: 2, created_at: new Date(), updated_at: new Date(),
    }] },
  };
}

const input = {
  baseAmount: "10.00",
  paymentTypeId: "transfer",
  accountId: "account",
  paymentCurrencyId: "CUP",
  planCurrencyId: "EUR",
  exchangeRateId: "rate",
};

describe("R5.1 method surcharge quote", () => {
  test("opción A suma el recargo a la base y conserva la base del plan", async () => {
    const quote = await quoteMethodSurcharge(database(), input, "gym-a", new Date("2026-07-01T00:00:00Z"));
    expect(quote).toMatchObject({ base: "10.00", porcentaje: "5.00", recargo: "1.00", total: "11.00", equivalente_plan: "0.02" });
    expect(quote.snapshot).toMatchObject({ recargo_metodo_politica: "R51-A-CEIL-V1", recargo_metodo_tasa_version: 3 });
  });

  test("el total recibido 10 queda en base 9 y 11 cubre base 10", async () => {
    const shortQuote = await quoteMethodSurcharge(
      database(),
      { ...input, baseAmount: undefined, receivedAmount: "10.00" },
      "gym-a",
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(shortQuote).toMatchObject({
      base: "9.00",
      recargo: "1.00",
      total: "10.00",
      equivalente_plan: "0.02",
      equivalente_total_plan: "0.02",
    });

    const completeQuote = await quoteMethodSurcharge(
      database(),
      { ...input, baseAmount: undefined, receivedAmount: "11.00" },
      "gym-a",
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(completeQuote).toMatchObject({
      base: "10.00",
      recargo: "1.00",
      total: "11.00",
      equivalente_plan: "0.02",
      equivalente_total_plan: "0.02",
    });
  });

  test("la confirmación rechaza total alterado o versión obsoleta", async () => {
    await expect(quoteMethodSurcharge(database(), { ...input, confirmation: true, totalAmount: "10.00", exchangeRateVersion: 3 }, "gym-a", new Date("2026-07-01T00:00:00Z"))).rejects.toBeInstanceOf(MethodSurchargeError);
    await expect(quoteMethodSurcharge(database({ rateVersion: 4 }), { ...input, confirmation: true, totalAmount: "11.00", exchangeRateVersion: 3 }, "gym-a", new Date("2026-07-01T00:00:00Z"))).rejects.toMatchObject({ status: 409 });
  });

  test("una cuenta de otra sede falla cerrada", async () => {
    await expect(quoteMethodSurcharge(database({ accountGym: "gym-b" }), input, "gym-a", new Date("2026-07-01T00:00:00Z"))).rejects.toMatchObject({ status: 403 });
  });

  test("M3 cotiza la excepción de sede y congela su versión efectiva", async () => {
    const quote = await quoteMethodSurcharge(
      database({ sitePct: "8.00" }), input, "gym-a", new Date("2026-07-01T00:00:00Z"),
    );
    expect(quote).toMatchObject({ porcentaje: "8.00", recargo_fuente: "SEDE", tipo_cambio_version: 3000002 });
    expect(quote.snapshot.recargo_metodo_tasa_version).toBe(3000002);
  });
});
