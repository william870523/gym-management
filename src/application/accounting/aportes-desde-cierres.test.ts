import { describe, expect, it } from "bun:test";
import {
  aporteDesdeCierreMensual,
  aporteDesdeCierrePeriodo,
  unirTraducciones,
} from "./aportes-desde-cierres";

/**
 * M6 — leer los cierres firmados sin inventarles nada.
 *
 * Lo que se fija aquí es la diferencia entre «esta sede no cobró nada por cuenta
 * de otra» y «este cierre no lo distinguía». La primera es un dato; la segunda,
 * una laguna. Tomar la laguna por un cero deja un certificado firmado afirmando
 * algo que nadie comprobó, y un certificado no se corrige: se vuelve a firmar.
 */
describe("M6 · aporte desde el certificado por período", () => {
  const snapshot = (monedas: unknown) => JSON.stringify({ resumen_monedas: monedas });

  it("toma el cobro neto como ingreso y el ajeno por separado", () => {
    const r = aporteDesdeCierrePeriodo({
      gymId: "gym-oeste",
      snapshotJson: snapshot([
        { moneda_id: "cup", cobro_neto: "1200.00", cobrado_cuenta_ajena_neto: "300.00" },
      ]),
    });
    expect(r.aportes).toEqual([
      {
        gymId: "gym-oeste",
        monedaId: "cup",
        ingresoMenor: 120_000,
        cobradoPorCuentaAjenaMenor: 30_000,
        origenCierre: "PERIODO",
      },
    ]);
    expect(r.avisos).toEqual([]);
  });

  it("un cero declarado es un dato y no genera aviso", () => {
    const r = aporteDesdeCierrePeriodo({
      gymId: "gym-centro",
      snapshotJson: snapshot([
        { moneda_id: "cup", cobro_neto: "500.00", cobrado_cuenta_ajena_neto: "0.00" },
      ]),
    });
    expect(r.aportes[0].cobradoPorCuentaAjenaMenor).toBe(0);
    expect(r.avisos).toEqual([]);
  });

  it("enseña el código de la moneda que el cierre congeló, no su UUID", () => {
    // Un informe que diga «1dbc5b00-…» en vez de «CUP» no lo puede leer nadie, y
    // resolverlo contra el catálogo de hoy haría que renombrar una moneda
    // cambiara lo que dice un certificado de julio.
    const r = aporteDesdeCierrePeriodo({
      gymId: "gym-centro",
      snapshotJson: snapshot([
        {
          moneda_id: "1dbc5b00",
          codigo: "CUP",
          cobro_neto: "500.00",
          cobrado_cuenta_ajena_neto: "0.00",
        },
      ]),
    });
    expect(r.codigos).toEqual({ "1dbc5b00": "CUP" });
  });

  it("un cierre anterior a la separación lo dice, y no finge un cero", () => {
    const r = aporteDesdeCierrePeriodo({
      gymId: "gym-centro",
      snapshotJson: snapshot([{ moneda_id: "cup", cobro_neto: "500.00" }]),
    });
    expect(r.aportes[0].ingresoMenor).toBe(50_000);
    expect(r.avisos[0]).toContain("anterior a la separación");
    expect(r.avisos[0]).toContain("gym-centro");
  });

  it("cada moneda va por separado", () => {
    const r = aporteDesdeCierrePeriodo({
      gymId: "gym-centro",
      snapshotJson: snapshot([
        { moneda_id: "cup", cobro_neto: "500.00", cobrado_cuenta_ajena_neto: "0.00" },
        { moneda_id: "usd", cobro_neto: "40.00", cobrado_cuenta_ajena_neto: "0.00" },
      ]),
    });
    expect(r.aportes.map((a) => [a.monedaId, a.ingresoMenor])).toEqual([
      ["cup", 50_000],
      ["usd", 4_000],
    ]);
  });

  it("un snapshot ilegible no aporta y se queja con el nombre de la sede", () => {
    const r = aporteDesdeCierrePeriodo({ gymId: "gym-norte", snapshotJson: "{roto" });
    expect(r.aportes).toEqual([]);
    expect(r.avisos[0]).toContain("gym-norte");
  });

  it("una moneda sin cobro neto queda fuera, dicho", () => {
    const r = aporteDesdeCierrePeriodo({
      gymId: "gym-norte",
      snapshotJson: snapshot([{ moneda_id: "cup" }]),
    });
    expect(r.aportes).toEqual([]);
    expect(r.avisos[0]).toContain("no declara cobro neto");
  });
});

describe("M6 · aporte desde el cierre mensual formal", () => {
  const mensual = (caja: Record<string, string>) =>
    JSON.stringify({
      resultado_operativo: { monedas: [{ moneda_id: "cup", caja }] },
    });

  it("rearma el ingreso quitando cambio y anulaciones", () => {
    // La misma cuenta que el certificado por período congela como `cobro_neto`.
    const r = aporteDesdeCierreMensual({
      gymId: "gym-centro",
      snapshotJson: mensual({
        cobros_brutos: "1000.00",
        cambio_entregado_neto: "50.00",
        anulaciones_netas: "20.00",
        cobrado_por_cuenta_ajena: "0.00",
      }),
    });
    expect(r.aportes[0].ingresoMenor).toBe(93_000);
    expect(r.aportes[0].origenCierre).toBe("MENSUAL");
    expect(r.avisos).toEqual([]);
  });

  it("no usa el flujo operativo como ingreso", () => {
    // `flujo_operativo` ya lleva restados pagos a entrenadores, reembolsos y
    // gastos: eso no es el ingreso, es lo que se hizo con él.
    const r = aporteDesdeCierreMensual({
      gymId: "gym-centro",
      snapshotJson: JSON.stringify({
        resultado_operativo: {
          monedas: [
            {
              moneda_id: "cup",
              caja: {
                cobros_brutos: "1000.00",
                cambio_entregado_neto: "0.00",
                anulaciones_netas: "0.00",
                pagos_entrenadores_netos: "400.00",
                flujo_operativo: "600.00",
                cobrado_por_cuenta_ajena: "0.00",
              },
            },
          ],
        },
      }),
    });
    expect(r.aportes[0].ingresoMenor).toBe(100_000);
  });

  it("el ajeno del mensual viaja aparte igual que en el período", () => {
    const r = aporteDesdeCierreMensual({
      gymId: "gym-oeste",
      snapshotJson: mensual({
        cobros_brutos: "800.00",
        cambio_entregado_neto: "0.00",
        anulaciones_netas: "0.00",
        cobrado_por_cuenta_ajena: "300.00",
      }),
    });
    expect(r.aportes[0].ingresoMenor).toBe(80_000);
    expect(r.aportes[0].cobradoPorCuentaAjenaMenor).toBe(30_000);
  });

  it("un mensual sin resultado operativo no se consolida a ciegas", () => {
    // Firmado antes de que ese bloque existiera. Recalcularlo aquí sería
    // reescribir un cierre firmado, que es lo que §6.3 prohíbe.
    const r = aporteDesdeCierreMensual({
      gymId: "gym-sur",
      snapshotJson: JSON.stringify({ resumen: { monedas: [] } }),
    });
    expect(r.aportes).toEqual([]);
    expect(r.avisos[0]).toContain("no trae resultado operativo");
  });
});

describe("M6 · unir traducciones", () => {
  it("conserva todos los aportes y todos los avisos", () => {
    const uno = aporteDesdeCierrePeriodo({
      gymId: "gym-centro",
      snapshotJson: JSON.stringify({
        resumen_monedas: [{ moneda_id: "cup", cobro_neto: "10.00" }],
      }),
    });
    const otro = aporteDesdeCierrePeriodo({
      gymId: "gym-oeste",
      snapshotJson: "{roto",
    });
    const junto = unirTraducciones([uno, otro]);
    expect(junto.aportes).toHaveLength(1);
    expect(junto.avisos).toHaveLength(2);
  });

  it("sin traducciones no inventa nada", () => {
    expect(unirTraducciones([])).toEqual({ aportes: [], avisos: [], codigos: {} });
  });
});
