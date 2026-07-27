import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { AccrualOperatingResultService } from "./accrual-operating-result.service";
import type {
  ManagementMarginMonthlyCloseReader,
  ManagementMarginMonthlyCloseReadRow,
} from "./management-margin.reader";

const GYM = "gym-1";
const MONTH = "2026-07";

const marginReport = (overrides: Record<string, any> = {}) => ({
  mes: MONTH,
  naturaleza: "MARGEN_GERENCIAL",
  estado_periodo: overrides.estado_periodo ?? "PROVISIONAL",
  fecha_corte: "2026-07-31",
  cobertura: {
    membresias_evaluadas: 4,
    conceptos_costo_evaluados: 2,
    requieren_revision: 0,
    completa: true,
  },
  monedas: [{
    moneda_id: "cup",
    moneda_codigo: "CUP",
    ingreso_devengado_mes: "10000.00",
    costo_directo_mes: "2000.00",
    margen_directo_mes: "8000.00",
    fijo_no_distribuido_mes: "1000.00",
    margen_menos_fijo_mes: "7000.00",
  }],
  ...overrides,
});

const expenseReport = (overrides: Record<string, any> = {}) => ({
  mes: MONTH,
  naturaleza: "GASTO_DEVENGADO_GOBERNADO",
  estado_periodo: "HISTORICO_RECALCULADO",
  fecha_corte: "2026-07-31",
  cobertura: {
    gastos_evaluados: 1,
    requieren_revision: 0,
    gastos_pendientes_pago: 0,
    completa: true,
  },
  monedas: [{
    moneda_id: "cup",
    moneda_codigo: "CUP",
    devengado_mes: "1500.00",
    pagado_mes: "1500.00",
    pendiente_pago: "0.00",
    gastos: [{
      gasto_id: "gasto-alquiler",
      categoria_naturaleza: "OPERATIVO",
      mes_pertenencia: MONTH,
      estado: "PAGADO",
      importe: "1500.00",
    }],
  }],
  ...overrides,
});

const provider = (report: Record<string, any>) => ({
  get: async () => report,
});

function closeReaderFor(snapshot: Record<string, any> | null) {
  const json = snapshot ? JSON.stringify(snapshot) : "";
  const row: ManagementMarginMonthlyCloseReadRow | null = snapshot
    ? {
      monthlyCloseId: "close-1",
      month: MONTH,
      state: "CERRADO",
      sha256: createHash("sha256").update(json).digest("hex"),
      snapshotJson: json,
      closedAt: new Date("2026-08-01T00:00:00.000Z"),
      reopenedAt: null,
      lockKey: `MES:${MONTH}`,
    }
    : null;
  const reader: ManagementMarginMonthlyCloseReader = {
    readMonthlyClose: async () => row,
    readMonthlyCloses: async () => (row ? [row] : []),
  };
  return reader;
}

describe("accrual operating result service", () => {
  test("compone margen y gasto vivos del mismo mes", async () => {
    const service = new AccrualOperatingResultService(
      provider(marginReport()),
      provider(expenseReport()),
      closeReaderFor(null),
    );

    const result = await service.get({ gymId: GYM, month: MONTH });

    expect(result.mes).toBe(MONTH);
    expect(result.monedas[0].resultado_operativo_devengado_mes).toBe("5500.00");
    expect(result.certificado).toBe(false);
    expect(result.margen_certificado).toBe(false);
    expect(result.gasto_certificado).toBe(false);
  });

  test("resuelve el mes del margen cuando la petición no trae mes", async () => {
    const expenses = {
      calls: [] as unknown[],
      get: async (input: { gymId: string; month?: unknown }) => {
        expenses.calls.push(input.month);
        return expenseReport();
      },
    };
    const service = new AccrualOperatingResultService(
      provider(marginReport()),
      expenses,
      closeReaderFor(null),
    );

    await service.get({ gymId: GYM });

    expect(expenses.calls).toEqual([MONTH]);
  });

  test("un snapshot v4 congela el gasto y certifica el resultado completo", async () => {
    const frozen = expenseReport({
      monedas: [{
        moneda_id: "cup",
        moneda_codigo: "CUP",
        devengado_mes: "900.00",
        pagado_mes: "900.00",
        pendiente_pago: "0.00",
        gastos: [{
          gasto_id: "gasto-congelado",
          categoria_naturaleza: "OPERATIVO",
          mes_pertenencia: MONTH,
          estado: "PAGADO",
          importe: "900.00",
        }],
      }],
    });
    const service = new AccrualOperatingResultService(
      provider(marginReport({ certificado: true, estado_periodo: "CERTIFICADO" })),
      // El vivo diría 1500,00; si el snapshot manda, el resultado usa 900,00.
      provider(expenseReport()),
      closeReaderFor({
        version: 4,
        gym_id: GYM,
        mes: MONTH,
        gasto_devengado: frozen,
      }),
    );

    const result = await service.get({ gymId: GYM, month: MONTH });

    expect(result.gasto_certificado).toBe(true);
    expect(result.margen_certificado).toBe(true);
    expect(result.certificado).toBe(true);
    expect(result.estado_periodo).toBe("CERTIFICADO");
    expect(result.monedas[0].gasto_devengado_mes).toBe("900.00");
    expect(result.monedas[0].resultado_operativo_devengado_mes).toBe("6100.00");
  });

  test("un cierre v3 deja el gasto sin certificar y lo dice", async () => {
    const service = new AccrualOperatingResultService(
      provider(marginReport({ certificado: true, estado_periodo: "CERTIFICADO" })),
      provider(expenseReport()),
      closeReaderFor({
        version: 3,
        gym_id: GYM,
        mes: MONTH,
        resultado_devengado: marginReport(),
      }),
    );

    const result = await service.get({ gymId: GYM, month: MONTH });

    expect(result.margen_certificado).toBe(true);
    expect(result.gasto_certificado).toBe(false);
    expect(result.certificado).toBe(false);
    expect(result.nota_certificacion).toContain("anterior a R4.6");
    expect(result.monedas[0].gasto_devengado_mes).toBe("1500.00");
  });

  test("un snapshot manipulado no certifica el gasto", async () => {
    const reader = closeReaderFor({
      version: 4,
      gym_id: GYM,
      mes: MONTH,
      gasto_devengado: expenseReport(),
    });
    const original = await reader.readMonthlyClose(GYM, MONTH);
    const tampered: ManagementMarginMonthlyCloseReader = {
      readMonthlyClose: async () => ({
        ...original!,
        snapshotJson: original!.snapshotJson.replace("1500.00", "15.00"),
      }),
      readMonthlyCloses: async () => [],
    };
    const service = new AccrualOperatingResultService(
      provider(marginReport()),
      provider(expenseReport()),
      tampered,
    );

    const result = await service.get({ gymId: GYM, month: MONTH });

    expect(result.gasto_certificado).toBe(false);
  });

  test("rechaza el gimnasio vacío", async () => {
    const service = new AccrualOperatingResultService(
      provider(marginReport()),
      provider(expenseReport()),
      closeReaderFor(null),
    );

    await expect(service.get({ gymId: "  " })).rejects.toThrow(
      "No se pudo determinar el gimnasio del informe.",
    );
  });
});
