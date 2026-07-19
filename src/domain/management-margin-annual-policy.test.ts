import { describe, expect, test } from "bun:test";
import {
  buildManagementMarginAnnualComparison,
  ManagementMarginAnnualPolicyError,
  type ManagementMarginAnnualMonthInput,
  parseManagementMarginYear,
} from "./management-margin-annual-policy";

const currency = (
  id: string,
  code: string,
  revenue: string,
  cost: string,
  margin: string,
  fixed: string,
  afterFixed: string,
  accumulatedMargin = margin,
) => ({
  moneda_id: id,
  moneda_codigo: code,
  ingreso_devengado_mes: revenue,
  costo_directo_mes: cost,
  margen_directo_mes: margin,
  fijo_no_distribuido_mes: fixed,
  margen_menos_fijo_mes: afterFixed,
  ingreso_devengado_acumulado: revenue,
  costo_directo_acumulado: cost,
  margen_directo_acumulado: accumulatedMargin,
  fijo_no_distribuido_acumulado: fixed,
  margen_menos_fijo_acumulado: afterFixed,
});

const certified = (
  month: string,
  currencies: Record<string, any>[],
): ManagementMarginAnnualMonthInput => ({
  month,
  status: "CERTIFICADO",
  reason: "Snapshot R4.4 íntegro.",
  monthlyCloseId: `close-${month}`,
  sha256: `hash-${month}`,
  closedAt: `${month}-28T12:00:00.000Z`,
  result: {
    mes: month,
    naturaleza: "MARGEN_GERENCIAL",
    certificado: true,
    monedas: currencies,
  },
});

describe("management margin annual policy", () => {
  test("suma solo devengado mensual certificado y conserva el último acumulado", () => {
    const months: ManagementMarginAnnualMonthInput[] = [
      certified("2026-01", [
        currency("cup", "CUP", "100.00", "25.00", "75.00", "5.00", "70.00"),
        currency("eur", "EUR", "40.00", "0.00", "40.00", "0.00", "40.00"),
      ]),
      certified("2026-02", [
        currency(
          "cup",
          "CUP",
          "200.00",
          "80.00",
          "120.00",
          "20.00",
          "100.00",
          "195.00",
        ),
      ]),
      {
        month: "2026-03",
        status: "SNAPSHOT_ANTERIOR",
        reason: "El cierre usa snapshot v2.",
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
    const result = buildManagementMarginAnnualComparison({
      year: "2026",
      currentBusinessMonth: "2026-07",
      months,
    });

    expect(result.cobertura.meses_exigibles).toBe(6);
    expect(result.cobertura.meses_certificados).toBe(2);
    expect(result.cobertura.meses_pendientes).toBe(4);
    const cup = result.monedas.find((item) => item.moneda_codigo === "CUP")!;
    const eur = result.monedas.find((item) => item.moneda_codigo === "EUR")!;
    expect(cup.totales_devengo.ingreso_devengado).toBe("300.00");
    expect(cup.totales_devengo.margen_directo).toBe("195.00");
    expect(cup.totales_devengo.margen_directo_pct).toBe("65.0");
    expect(cup.ultimo_corte?.mes).toBe("2026-02");
    expect(cup.ultimo_corte?.margen_directo_acumulado).toBe("195.00");
    expect(cup.meses).toHaveLength(2);
    expect(eur.meses).toHaveLength(1);
    expect(result.limitaciones[1]).toContain("último corte");
  });

  test("un snapshot incompatible deja de contar y no aporta importes", () => {
    const source = certified("2026-01", [{
      ...currency("cup", "CUP", "100.00", "25.00", "75.00", "5.00", "70.00"),
      costo_directo_mes: null,
    }]);
    const result = buildManagementMarginAnnualComparison({
      year: "2026",
      currentBusinessMonth: "2026-02",
      months: [source],
    });

    expect(result.cobertura.meses_certificados).toBe(0);
    expect(result.meses[0]?.estado).toBe("SNAPSHOT_INCOMPATIBLE");
    expect(result.monedas).toHaveLength(0);
    expect(source.status).toBe("CERTIFICADO");
  });

  test("un mes BLOQUEO_INVALIDO no se certifica ni aporta importes", () => {
    // R4.5.1: el servicio marca BLOQUEO_INVALIDO cuando un cierre CERRADO perdió
    // su bloqueo. La política solo debe propagar el estado sin tocar importes.
    const months: ManagementMarginAnnualMonthInput[] = [
      {
        month: "2026-01",
        status: "BLOQUEO_INVALIDO",
        reason: "El cierre está CERRADO pero perdió su bloqueo activo.",
        monthlyCloseId: "close-jan",
        sha256: "hash-jan",
        closedAt: "2026-01-28T12:00:00.000Z",
      },
      {
        month: "2026-02",
        status: "EN_CURSO",
        reason: "Mes comercial en curso.",
      },
    ];
    const result = buildManagementMarginAnnualComparison({
      year: "2026",
      currentBusinessMonth: "2026-02",
      months,
    });

    expect(result.cobertura.meses_exigibles).toBe(1);
    expect(result.cobertura.meses_certificados).toBe(0);
    expect(result.cobertura.meses_pendientes).toBe(1);
    expect(result.meses[0]?.estado).toBe("BLOQUEO_INVALIDO");
    expect(result.monedas).toHaveLength(0);
  });

  test("rechaza años ambiguos", () => {
    expect(() => parseManagementMarginYear("26"))
      .toThrow(ManagementMarginAnnualPolicyError);
  });
});
