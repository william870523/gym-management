import { describe, expect, test } from "bun:test";
import {
  buildOperationalAnnualComparison,
  OperationalResultsAnnualPolicyError,
  type OperationalAnnualMonthInput,
  parseOperationalResultsYear,
} from "./operational-results-annual-policy";

const currency = (
  id: string,
  code: string,
  gross: string,
  exits: string,
  flow: string,
  reserve: string,
) => ({
  moneda_id: id,
  moneda_codigo: code,
  caja: {
    cobros_brutos: gross,
    salidas_libro: exits,
    flujo_operativo: flow,
    pagos_entrenadores_netos: "10.00",
    reembolsos_netos: "2.00",
    otros_egresos_operativos: "3.00",
  },
  obligaciones: {
    reserva_inmediata: reserve,
    entrenador_pagadero_ahora: "8.00",
    entrenador_futuro: "4.00",
    reembolsos_pendientes: "1.00",
    compromiso_total: "13.00",
  },
});

const certified = (
  month: string,
  currencies: Record<string, any>[],
): OperationalAnnualMonthInput => ({
  month,
  status: "CERTIFICADO",
  reason: "Snapshot R3 íntegro.",
  monthlyCloseId: `close-${month}`,
  sha256: `hash-${month}`,
  closedAt: `${month}-28T12:00:00.000Z`,
  result: {
    mes: month,
    naturaleza: "RESULTADO_OPERATIVO_DE_CAJA",
    monedas: currencies,
  },
});

describe("remote operational annual results policy parity", () => {
  test("suma solo flujos certificados y conserva la reserva del último corte", () => {
    const months: OperationalAnnualMonthInput[] = [
      certified("2026-01", [
        currency("cup", "CUP", "100.10", "40.00", "60.10", "20.00"),
        currency("eur", "EUR", "25.00", "5.00", "20.00", "3.00"),
      ]),
      certified("2026-02", [
        currency("cup", "CUP", "200.20", "70.00", "130.20", "35.00"),
      ]),
      {
        month: "2026-03",
        status: "SNAPSHOT_ANTERIOR",
        reason: "El cierre usa snapshot v1.",
      },
      ...["04", "05", "06"].map((value) => ({
        month: `2026-${value}`,
        status: "SIN_CIERRE" as const,
        reason: "El mes no tiene cierre certificado.",
      })),
      {
        month: "2026-07",
        status: "EN_CURSO",
        reason: "Mes comercial en curso.",
      },
      ...["08", "09", "10", "11", "12"].map((value) => ({
        month: `2026-${value}`,
        status: "FUTURO" as const,
        reason: "Mes comercial futuro.",
      })),
    ];
    const result = buildOperationalAnnualComparison({
      year: "2026",
      currentBusinessMonth: "2026-07",
      months,
    });

    expect(result.cobertura.meses_exigibles).toBe(6);
    expect(result.cobertura.meses_certificados).toBe(2);
    expect(result.cobertura.meses_pendientes).toBe(4);
    expect(result.cobertura.porcentaje_exigible).toBe(33.3);
    const cup = result.monedas.find((item) => item.moneda_codigo === "CUP")!;
    const eur = result.monedas.find((item) => item.moneda_codigo === "EUR")!;
    expect(cup.totales_flujo.cobros_brutos).toBe("300.30");
    expect(cup.totales_flujo.flujo_operativo).toBe("190.30");
    expect(cup.ultimo_corte?.mes).toBe("2026-02");
    expect(cup.ultimo_corte?.reserva_inmediata).toBe("35.00");
    expect(cup.meses).toHaveLength(2);
    expect(eur.meses).toHaveLength(1);
    expect(result.limitaciones[1]).toContain("último corte");
  });

  test("un snapshot incompatible deja de contar y no aporta importes", () => {
    const source = certified("2026-01", [{
      ...currency("cup", "CUP", "100.00", "10.00", "90.00", "20.00"),
      caja: { cobros_brutos: "100.00" },
    }]);
    const result = buildOperationalAnnualComparison({
      year: "2026",
      currentBusinessMonth: "2026-02",
      months: [source],
    });
    expect(result.cobertura.meses_certificados).toBe(0);
    expect(result.meses[0]?.estado).toBe("SNAPSHOT_INCOMPATIBLE");
    expect(result.monedas).toHaveLength(0);
    expect(source.status).toBe("CERTIFICADO");
  });

  test("rechaza años ambiguos", () => {
    expect(() => parseOperationalResultsYear("26"))
      .toThrow(OperationalResultsAnnualPolicyError);
  });
});
