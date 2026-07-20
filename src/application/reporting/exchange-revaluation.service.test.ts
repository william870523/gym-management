import { describe, expect, it } from "bun:test";
import {
  ExchangeRevaluationService,
  ExchangeRevaluationServiceError,
} from "./exchange-revaluation.service";
import type {
  ExchangeRevaluationReadData,
  ExchangeRevaluationReader,
} from "./exchange-revaluation.reader";

const EUR = "cur-eur";
const CUP = "cur-cup";
const GYM = "local-gym-001";

const eurToCup = (rate: number) => ({
  monedaIdBase: EUR,
  monedaIdTarget: CUP,
  exchangeRate: rate,
});

class FakeReader implements ExchangeRevaluationReader {
  constructor(private readonly data: ExchangeRevaluationReadData) {}
  async currentBusinessMonth() {
    return "2026-07";
  }
  async read() {
    return this.data;
  }
}

const baseData = (): ExchangeRevaluationReadData => ({
  baseCurrencyId: EUR,
  currencyCodes: new Map([
    [EUR, "EUR"],
    [CUP, "CUP"],
  ]),
  collections: [
    {
      reference: "d1",
      weakCurrencyId: CUP,
      amount: "2700.00",
      collectionRate: eurToCup(300),
    },
    {
      reference: "d2",
      weakCurrencyId: CUP,
      amount: "1500.00",
      collectionRate: eurToCup(300),
    },
  ],
  cutoffRatesByCurrency: new Map([[CUP, eurToCup(500)]]),
});

describe("ExchangeRevaluationService", () => {
  it("valúa los cobros vivos y reporta la pérdida cambiaria", async () => {
    const service = new ExchangeRevaluationService(new FakeReader(baseData()));
    const report = await service.get({ gymId: GYM, month: "2026-07" });

    expect(report.mes).toBe("2026-07");
    expect(report.fecha_corte).toBe("2026-07-31");
    expect(report.moneda_base_codigo).toBe("EUR");
    expect(report.monedas).toHaveLength(1);
    const cup = report.monedas[0];
    expect(cup.moneda_codigo).toBe("CUP");
    expect(cup.valor_al_cobro).toBe("14.00"); // 9.00 + 5.00
    expect(cup.valor_al_corte).toBe("8.40"); // 5.40 + 3.00
    expect(cup.revaluacion).toBe("-5.60");
    expect(cup.efecto).toBe("PERDIDA");
    expect(report.total_revaluacion).toBe("-5.60");
    expect(report.efecto_total).toBe("PERDIDA");
    expect(report.estado).toBe("PROVISIONAL");
  });

  it("cuenta aparte los cobros sin tasa vigente al corte", async () => {
    const data = baseData();
    data.cutoffRatesByCurrency = new Map(); // ninguna tasa al corte
    const service = new ExchangeRevaluationService(new FakeReader(data));
    const report = await service.get({ gymId: GYM, month: "2026-07" });

    const cup = report.monedas[0];
    expect(cup.cobros).toBe(2);
    expect(cup.cobros_sin_tasa_corte).toBe(2);
    expect(cup.revaluacion).toBe("0.00");
    expect(report.total_revaluacion).toBe("0.00");
  });

  it("informa SIN_MONEDA_BASE cuando no hay moneda base configurada", async () => {
    const data = baseData();
    data.baseCurrencyId = null;
    const service = new ExchangeRevaluationService(new FakeReader(data));
    const report = await service.get({ gymId: GYM, month: "2026-07" });

    expect(report.estado).toBe("SIN_MONEDA_BASE");
    expect(report.monedas).toHaveLength(0);
    expect(report.total_revaluacion).toBe("0.00");
  });

  it("usa el mes comercial en curso cuando no se pide un mes", async () => {
    const service = new ExchangeRevaluationService(new FakeReader(baseData()));
    const report = await service.get({ gymId: GYM });
    expect(report.mes).toBe("2026-07");
  });

  it("rechaza sin gimnasio", async () => {
    const service = new ExchangeRevaluationService(new FakeReader(baseData()));
    await expect(service.get({ gymId: "  " })).rejects.toBeInstanceOf(
      ExchangeRevaluationServiceError,
    );
  });

  it("rechaza un mes con formato inválido", async () => {
    const service = new ExchangeRevaluationService(new FakeReader(baseData()));
    await expect(
      service.get({ gymId: GYM, month: "2026/7" }),
    ).rejects.toBeInstanceOf(ExchangeRevaluationServiceError);
  });
});
