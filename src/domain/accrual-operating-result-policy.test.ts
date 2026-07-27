import { describe, expect, test } from "bun:test";
import {
  AccrualOperatingResultPolicyError,
  buildAccrualOperatingResult,
} from "./accrual-operating-result-policy";

const marginCurrency = (overrides: Record<string, any> = {}) => ({
  moneda_id: overrides.moneda_id ?? "cup",
  moneda_codigo: overrides.moneda_codigo ?? "CUP",
  ingreso_devengado_mes: overrides.ingreso_devengado_mes ?? "10000.00",
  costo_directo_mes: overrides.costo_directo_mes ?? "2000.00",
  margen_directo_mes: overrides.margen_directo_mes ?? "8000.00",
  fijo_no_distribuido_mes: overrides.fijo_no_distribuido_mes ?? "1000.00",
  margen_menos_fijo_mes: overrides.margen_menos_fijo_mes ?? "7000.00",
});

const marginReport = (overrides: Record<string, any> = {}) => ({
  mes: overrides.mes ?? "2026-07",
  naturaleza: "MARGEN_GERENCIAL",
  estado_periodo: overrides.estado_periodo ?? "PROVISIONAL",
  fecha_corte: overrides.fecha_corte ?? "2026-07-18",
  cobertura: overrides.cobertura ?? {
    membresias_evaluadas: 12,
    conceptos_costo_evaluados: 4,
    requieren_revision: 0,
    completa: true,
  },
  monedas: overrides.monedas ?? [marginCurrency()],
});

const expenseRow = (overrides: Record<string, any> = {}) => ({
  gasto_id: overrides.gasto_id ?? "gasto-1",
  categoria_naturaleza: overrides.categoria_naturaleza ?? "OPERATIVO",
  mes_pertenencia: overrides.mes_pertenencia ?? "2026-07",
  estado: overrides.estado ?? "PENDIENTE",
  importe: overrides.importe ?? "1500.00",
});

const expenseCurrency = (overrides: Record<string, any> = {}) => ({
  moneda_id: overrides.moneda_id ?? "cup",
  moneda_codigo: overrides.moneda_codigo ?? "CUP",
  devengado_mes: overrides.devengado_mes ?? "1500.00",
  pagado_mes: overrides.pagado_mes ?? "0.00",
  pendiente_pago: overrides.pendiente_pago ?? "1500.00",
  gastos: overrides.gastos ?? [expenseRow()],
});

const expenseReport = (overrides: Record<string, any> = {}) => ({
  mes: overrides.mes ?? "2026-07",
  naturaleza: "GASTO_DEVENGADO_GOBERNADO",
  estado_periodo: overrides.estado_periodo ?? "PROVISIONAL",
  fecha_corte: overrides.fecha_corte ?? "2026-07-18",
  cobertura: overrides.cobertura ?? {
    gastos_evaluados: 1,
    requieren_revision: 0,
    gastos_pendientes_pago: 1,
    completa: true,
  },
  monedas: overrides.monedas ?? [expenseCurrency()],
});

describe("accrual operating result policy", () => {
  test("resta el gasto devengado al margen ya neto de compensación fija", () => {
    const result = buildAccrualOperatingResult({
      margin: marginReport(),
      expenses: expenseReport(),
    });

    expect(result.mes).toBe("2026-07");
    expect(result.naturaleza).toBe("RESULTADO_OPERATIVO_DEVENGADO");
    expect(result.monedas).toHaveLength(1);
    const cup = result.monedas[0];
    expect(cup.moneda_codigo).toBe("CUP");
    expect(cup.margen_menos_fijo_mes).toBe("7000.00");
    expect(cup.gasto_devengado_mes).toBe("1500.00");
    expect(cup.resultado_operativo_devengado_mes).toBe("5500.00");
    expect(cup.resultado_operativo_pct_ingreso_mes).toBe(55);
    expect(cup.solo_gasto).toBe(false);
  });

  test("no mezcla monedas y ordena por código", () => {
    const result = buildAccrualOperatingResult({
      margin: marginReport({
        monedas: [
          marginCurrency(),
          marginCurrency({
            moneda_id: "usd",
            moneda_codigo: "USD",
            ingreso_devengado_mes: "500.00",
            costo_directo_mes: "100.00",
            margen_directo_mes: "400.00",
            fijo_no_distribuido_mes: "0.00",
            margen_menos_fijo_mes: "400.00",
          }),
        ],
      }),
      expenses: expenseReport({
        monedas: [
          expenseCurrency(),
          expenseCurrency({
            moneda_id: "usd",
            moneda_codigo: "USD",
            devengado_mes: "120.00",
            pendiente_pago: "120.00",
            gastos: [expenseRow({ gasto_id: "gasto-usd", importe: "120.00" })],
          }),
        ],
      }),
    });

    expect(result.monedas.map((row: any) => row.moneda_codigo)).toEqual([
      "CUP",
      "USD",
    ]);
    expect(result.monedas[0].resultado_operativo_devengado_mes).toBe("5500.00");
    expect(result.monedas[1].resultado_operativo_devengado_mes).toBe("280.00");
  });

  test("desglosa por naturaleza en orden e ignora gastos de otro mes", () => {
    const result = buildAccrualOperatingResult({
      margin: marginReport(),
      expenses: expenseReport({
        monedas: [
          expenseCurrency({
            devengado_mes: "2300.00",
            pendiente_pago: "2300.00",
            gastos: [
              expenseRow({ gasto_id: "marketing", categoria_naturaleza: "ADMINISTRATIVO", importe: "300.00" }),
              expenseRow({ gasto_id: "alquiler", importe: "1500.00" }),
              expenseRow({ gasto_id: "equipos", categoria_naturaleza: "COSTO_VENTAS", importe: "500.00" }),
              // Pertenece a otro mes: aparece en el informe de gastos como flujo
              // de caja, pero no devenga en julio.
              expenseRow({ gasto_id: "junio", mes_pertenencia: "2026-06", importe: "9999.00" }),
            ],
          }),
        ],
      }),
    });

    const cup = result.monedas[0];
    expect(cup.gasto_por_naturaleza.map((row: any) => row.naturaleza)).toEqual([
      "OPERATIVO",
      "ADMINISTRATIVO",
      "COSTO_VENTAS",
    ]);
    expect(cup.gasto_por_naturaleza[0].devengado_mes).toBe("1500.00");
    expect(cup.gasto_por_naturaleza[1].devengado_mes).toBe("300.00");
    expect(cup.gasto_por_naturaleza[2].devengado_mes).toBe("500.00");
    expect(cup.resultado_operativo_devengado_mes).toBe("4700.00");
  });

  test("un gasto anulado no devenga", () => {
    const result = buildAccrualOperatingResult({
      margin: marginReport(),
      expenses: expenseReport({
        monedas: [
          expenseCurrency({
            devengado_mes: "1500.00",
            gastos: [
              expenseRow(),
              expenseRow({ gasto_id: "anulado", estado: "ANULADO", importe: "800.00" }),
            ],
          }),
        ],
      }),
    });

    expect(result.monedas[0].gasto_devengado_mes).toBe("1500.00");
    expect(result.monedas[0].resultado_operativo_devengado_mes).toBe("5500.00");
  });

  test("señala la moneda que solo tiene gasto y deja el resultado negativo", () => {
    const result = buildAccrualOperatingResult({
      margin: marginReport(),
      expenses: expenseReport({
        monedas: [
          expenseCurrency(),
          expenseCurrency({
            moneda_id: "usd",
            moneda_codigo: "USD",
            devengado_mes: "200.00",
            pendiente_pago: "200.00",
            gastos: [expenseRow({ gasto_id: "gasto-usd", importe: "200.00" })],
          }),
        ],
      }),
    });

    const usd = result.monedas.find((row: any) => row.moneda_codigo === "USD")!;
    expect(usd.solo_gasto).toBe(true);
    expect(usd.resultado_operativo_devengado_mes).toBe("-200.00");
    expect(usd.resultado_operativo_pct_ingreso_mes).toBeNull();
    expect(usd.explicacion).toContain("ningún ingreso devengado");
  });

  test("un pago de otro mes se informa aparte y no vuelve incompleta la cobertura", () => {
    const result = buildAccrualOperatingResult({
      margin: marginReport(),
      expenses: expenseReport({
        cobertura: {
          gastos_evaluados: 3,
          requieren_revision: 2,
          gastos_pendientes_pago: 1,
          completa: false,
        },
      }),
    });

    expect(result.cobertura.gastos_de_otro_mes_pagados_en_el_mes).toBe(2);
    expect(result.cobertura.requieren_revision).toBe(0);
    expect(result.cobertura.completa).toBe(true);
  });

  test("la cobertura incompleta del margen sí se propaga", () => {
    const result = buildAccrualOperatingResult({
      margin: marginReport({
        cobertura: {
          membresias_evaluadas: 5,
          conceptos_costo_evaluados: 2,
          requieren_revision: 3,
          completa: false,
        },
      }),
      expenses: expenseReport(),
    });

    expect(result.cobertura.completa).toBe(false);
    expect(result.cobertura.requieren_revision).toBe(3);
  });

  test("rechaza componer informes de meses distintos", () => {
    expect(() =>
      buildAccrualOperatingResult({
        margin: marginReport({ mes: "2026-07" }),
        expenses: expenseReport({ mes: "2026-06" }),
      })
    ).toThrow(AccrualOperatingResultPolicyError);
  });

  test("rechaza un desglose por naturaleza que no reconstruye el devengado", () => {
    expect(() =>
      buildAccrualOperatingResult({
        margin: marginReport(),
        expenses: expenseReport({
          monedas: [expenseCurrency({ devengado_mes: "1800.00" })],
        }),
      })
    ).toThrow(/desglose por naturaleza/);
  });
});
