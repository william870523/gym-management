import { describe, expect, it } from "bun:test";
import {
  ClientDiscountPolicyError,
  discountBreakdown,
  discountMinor,
  parseClientCategory,
} from "./client-discount-policy";

/**
 * Pruebas R5.3 — descuento por categoría de cliente.
 *
 * Orden de capas (no se prueba aquí; se prueba en payment.service.test):
 *   lista → descuento R5.3 → recargo R5.1.
 *
 * Patrón de redondeo: ceil a entero superior en unidades principales
 * (múltiplos de 100 centavos), idéntico a R5.1.
 */
describe("client-discount-policy · parseClientCategory", () => {
  it("acepta NUEVO y VIEJO en cualquier caja", () => {
    expect(parseClientCategory("NUEVO")).toBe("NUEVO");
    expect(parseClientCategory("viejo")).toBe("VIEJO");
    expect(parseClientCategory(" Nuevo ")).toBe("NUEVO");
  });

  it("rechaza categorías desconocidas", () => {
    expect(() => parseClientCategory("VIP")).toThrow(ClientDiscountPolicyError);
    expect(() => parseClientCategory("")).toThrow(ClientDiscountPolicyError);
    expect(() => parseClientCategory(null)).toThrow(ClientDiscountPolicyError);
  });
});

describe("client-discount-policy · discountMinor", () => {
  it("cliente NUEVO nunca tiene descuento", () => {
    expect(
      discountMinor({
        listPrice: "30.00",
        clientCategory: "NUEVO",
        discountPct: "16.67",
        planFixedOldPrice: null,
      }),
    ).toBe(0n);
  });

  it("cliente VIEJO con excepción fija usa lista − excepción", () => {
    // 12.00 lista, excepción 10.00 → descuento 2.00 exacto.
    expect(
      discountMinor({
        listPrice: "12.00",
        clientCategory: "VIEJO",
        discountPct: "16.67",
        planFixedOldPrice: "10.00",
      }),
    ).toBe(200n);
  });

  it("la excepción fija anula el porcentaje global", () => {
    // Aunque el % sea 50, la excepción fija prevalece.
    expect(
      discountMinor({
        listPrice: "12.00",
        clientCategory: "VIEJO",
        discountPct: "50.00",
        planFixedOldPrice: "10.00",
      }),
    ).toBe(200n);
  });

  it("cliente VIEJO con % y sin excepción aplica ceil a entero superior", () => {
    // 30.00 × 16.67 % = 5.001 → ceil a 6.00 (mismo patrón que R5.1).
    expect(
      discountMinor({
        listPrice: "30.00",
        clientCategory: "VIEJO",
        discountPct: "16.67",
        planFixedOldPrice: null,
      }),
    ).toBe(600n);
  });

  it("% exacto sin residuo no se infla", () => {
    // 20.00 × 10 % = 2.00 exacto → no hay ceil que aplicar.
    expect(
      discountMinor({
        listPrice: "20.00",
        clientCategory: "VIEJO",
        discountPct: "10.00",
        planFixedOldPrice: null,
      }),
    ).toBe(200n);
  });

  it("% cero no descuenta nada", () => {
    expect(
      discountMinor({
        listPrice: "30.00",
        clientCategory: "VIEJO",
        discountPct: "0.00",
        planFixedOldPrice: null,
      }),
    ).toBe(0n);
  });

  it("rechaza precio de lista negativo", () => {
    expect(() =>
      discountMinor({
        listPrice: "-5.00",
        clientCategory: "VIEJO",
        discountPct: "10.00",
        planFixedOldPrice: null,
      }),
    ).toThrow(ClientDiscountPolicyError);
  });

  it("rechaza excepción fija negativa", () => {
    expect(() =>
      discountMinor({
        listPrice: "30.00",
        clientCategory: "VIEJO",
        discountPct: "10.00",
        planFixedOldPrice: "-1.00",
      }),
    ).toThrow(ClientDiscountPolicyError);
  });

  it("rechaza excepción fija mayor que el precio de lista", () => {
    expect(() =>
      discountMinor({
        listPrice: "10.00",
        clientCategory: "VIEJO",
        discountPct: "10.00",
        planFixedOldPrice: "12.00",
      }),
    ).toThrow(ClientDiscountPolicyError);
  });

  it("rechaza % fuera de rango", () => {
    expect(() =>
      discountMinor({
        listPrice: "30.00",
        clientCategory: "VIEJO",
        discountPct: "150.00",
        planFixedOldPrice: null,
      }),
    ).toThrow(ClientDiscountPolicyError);
    expect(() =>
      discountMinor({
        listPrice: "30.00",
        clientCategory: "VIEJO",
        discountPct: "-5.00",
        planFixedOldPrice: null,
      }),
    ).toThrow(ClientDiscountPolicyError);
  });
});

describe("client-discount-policy · discountBreakdown", () => {
  it("cliente NUEVO: motivo SIN_DESCUENTO y sin %", () => {
    const b = discountBreakdown({
      listPrice: "12.00",
      clientCategory: "NUEVO",
      discountPct: "16.67",
      planFixedOldPrice: null,
    });
    expect(b.precio_lista).toBe("12.00");
    expect(b.descuento).toBe("0.00");
    expect(b.precio_final).toBe("12.00");
    expect(b.descuento_pct).toBeNull();
    expect(b.motivo).toBe("SIN_DESCUENTO");
  });

  it("excepción fija: motivo EXCEPCION_FIJA y sin %", () => {
    const b = discountBreakdown({
      listPrice: "12.00",
      clientCategory: "VIEJO",
      discountPct: "16.67",
      planFixedOldPrice: "10.00",
    });
    expect(b.precio_lista).toBe("12.00");
    expect(b.descuento).toBe("2.00");
    expect(b.precio_final).toBe("10.00");
    expect(b.descuento_pct).toBeNull();
    expect(b.motivo).toBe("EXCEPCION_FIJA");
  });

  it("porcentaje global: motivo PORCENTAJE_GLOBAL y % devuelto", () => {
    const b = discountBreakdown({
      listPrice: "30.00",
      clientCategory: "VIEJO",
      discountPct: "16.67",
      planFixedOldPrice: null,
    });
    expect(b.precio_lista).toBe("30.00");
    expect(b.descuento).toBe("6.00");
    expect(b.precio_final).toBe("24.00");
    expect(b.descuento_pct).toBe("16.67");
    expect(b.motivo).toBe("PORCENTAJE_GLOBAL");
  });

  it("preserva el precio de lista para el recibo", () => {
    // El recibo debe mostrar lista y final por separado; no se pierde la lista.
    const b = discountBreakdown({
      listPrice: "25.00",
      clientCategory: "VIEJO",
      discountPct: "0.00",
      planFixedOldPrice: null,
    });
    expect(b.precio_lista).toBe("25.00");
    expect(b.precio_final).toBe("25.00");
  });
});
