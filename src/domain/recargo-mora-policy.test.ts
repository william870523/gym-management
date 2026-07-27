import { describe, expect, it } from "bun:test";
import {
  calcularDiasAtraso,
  normalizeRecargoMoraConfig,
  recargoMoraColumns,
  buildRecargoMoraCondonacion,
  quoteRecargoMora,
  RecargoMoraPolicyError,
  type RecargoMoraPlanConfig,
} from "./recargo-mora-policy";

describe("recargoMoraColumns", () => {
  it("plan sin recargo: todo null y activo false", () => {
    expect(recargoMoraColumns({})).toEqual({
      recargo_mora_modo: null,
      recargo_mora_valor: null,
      recargo_mora_tope: null,
      recargo_mora_activo: false,
    });
  });

  it("porcentaje activo se normaliza a columnas", () => {
    expect(
      recargoMoraColumns({ modo: "PORCENTAJE", valor: "10", activo: true }),
    ).toEqual({
      recargo_mora_modo: "PORCENTAJE",
      recargo_mora_valor: "10.00",
      recargo_mora_tope: null,
      recargo_mora_activo: true,
    });
  });

  it("por día con tope conserva el tope", () => {
    expect(
      recargoMoraColumns({ modo: "POR_DIA", valor: "1.5", tope: "10", activo: true }),
    ).toEqual({
      recargo_mora_modo: "POR_DIA",
      recargo_mora_valor: "1.50",
      recargo_mora_tope: "10.00",
      recargo_mora_activo: true,
    });
  });

  it("configuración inválida se rechaza (no se persiste basura)", () => {
    expect(() => recargoMoraColumns({ modo: "PORCENTAJE", valor: "-5" })).toThrow(
      RecargoMoraPolicyError,
    );
    expect(() => recargoMoraColumns({ modo: "INVENTADO", valor: "1" })).toThrow();
  });
});

describe("buildRecargoMoraCondonacion", () => {
  it("condonación válida devuelve importe, motivo y actor", () => {
    expect(
      buildRecargoMoraCondonacion({
        importeQueSeIbaACobrar: "3.00",
        motivo: "El socio estuvo hospitalizado",
        condonadoPorUserId: "user-1",
      }),
    ).toEqual({
      recargo_mora_condonado_importe: "3.00",
      recargo_mora_condonado_motivo: "El socio estuvo hospitalizado",
      recargo_mora_condonado_por: "user-1",
    });
  });

  it("sin motivo se rechaza (no se puede perdonar en silencio)", () => {
    expect(() =>
      buildRecargoMoraCondonacion({ importeQueSeIbaACobrar: "3.00", motivo: "" }),
    ).toThrow(RecargoMoraPolicyError);
  });

  it("motivo demasiado corto se rechaza", () => {
    expect(() =>
      buildRecargoMoraCondonacion({ importeQueSeIbaACobrar: "3.00", motivo: "ok" }),
    ).toThrow(RecargoMoraPolicyError);
  });

  it("sin recargo que condonar se rechaza", () => {
    expect(() =>
      buildRecargoMoraCondonacion({ importeQueSeIbaACobrar: "0.00", motivo: "motivo válido" }),
    ).toThrow(RecargoMoraPolicyError);
  });

  it("sin actor autenticado guarda null, no inventa uno", () => {
    const r = buildRecargoMoraCondonacion({
      importeQueSeIbaACobrar: "5.00", motivo: "cortesía autorizada",
    });
    expect(r.recargo_mora_condonado_por).toBeNull();
  });
});

describe("calcularDiasAtraso", () => {
  const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("sin vencimiento no hay atraso", () => {
    expect(calcularDiasAtraso(dia("2026-07-23"), null)).toBe(0);
    expect(calcularDiasAtraso(dia("2026-07-23"), undefined)).toBe(0);
  });

  it("pagando el mismo día no hay atraso", () => {
    expect(calcularDiasAtraso(dia("2026-07-23"), dia("2026-07-23"))).toBe(0);
  });

  it("pagando antes del vencimiento no hay atraso", () => {
    expect(calcularDiasAtraso(dia("2026-07-20"), dia("2026-07-23"))).toBe(0);
  });

  it("cuenta días completos de atraso", () => {
    expect(calcularDiasAtraso(dia("2026-07-28"), dia("2026-07-23"))).toBe(5);
    expect(calcularDiasAtraso(dia("2026-08-23"), dia("2026-07-23"))).toBe(31);
  });

  it("ignora la hora del vencimiento (normaliza a día)", () => {
    const venceTarde = new Date("2026-07-23T23:59:59.000Z");
    expect(calcularDiasAtraso(dia("2026-07-25"), venceTarde)).toBe(2);
  });
});

const activo = (
  modo: RecargoMoraPlanConfig["modo"],
  valor: string,
  tope: string | null = null,
): RecargoMoraPlanConfig => ({ modo, valor, tope, activo: true });

describe("normalizeRecargoMoraConfig", () => {
  it("devuelve null cuando no hay modo (plan sin recargo)", () => {
    expect(normalizeRecargoMoraConfig({})).toBeNull();
    expect(normalizeRecargoMoraConfig({ modo: "" })).toBeNull();
  });

  it("normaliza porcentaje válido", () => {
    expect(
      normalizeRecargoMoraConfig({ modo: "porcentaje", valor: "10", activo: true }),
    ).toEqual({ modo: "PORCENTAJE", valor: "10.00", tope: null, activo: true });
  });

  it("rechaza modo inválido", () => {
    expect(() => normalizeRecargoMoraConfig({ modo: "OTRO", valor: "1" })).toThrow(
      RecargoMoraPolicyError,
    );
  });

  it("rechaza valor no positivo y porcentaje > 100", () => {
    expect(() => normalizeRecargoMoraConfig({ modo: "PORCENTAJE", valor: "0" })).toThrow();
    expect(() => normalizeRecargoMoraConfig({ modo: "PORCENTAJE", valor: "150" })).toThrow();
  });

  it("acepta tope solo en POR_DIA", () => {
    expect(
      normalizeRecargoMoraConfig({ modo: "POR_DIA", valor: "1.00", tope: "3.00", activo: true }),
    ).toEqual({ modo: "POR_DIA", valor: "1.00", tope: "3.00", activo: true });
    expect(() =>
      normalizeRecargoMoraConfig({ modo: "MONTO_FIJO", valor: "5", tope: "3" }),
    ).toThrow();
  });
});

describe("quoteRecargoMora — modos", () => {
  it("PORCENTAJE: 30.00 base, 10% → recargo 3.00, total 33.00", () => {
    const q = quoteRecargoMora({
      baseAmount: "30.00",
      diasAtraso: 5,
      aplicar: true,
      config: activo("PORCENTAJE", "10.00"),
    });
    expect(q).toMatchObject({ aplicado: true, recargo: "3.00", total: "33.00", motivo: "OK" });
  });

  it("PORCENTAJE sobre base con descuento: 25.00 base, 10% → 2.50", () => {
    const q = quoteRecargoMora({
      baseAmount: "25.00",
      diasAtraso: 3,
      aplicar: true,
      config: activo("PORCENTAJE", "10.00"),
    });
    expect(q.recargo).toBe("2.50");
    expect(q.total).toBe("27.50");
  });

  it("MONTO_FIJO: recargo fijo sin importar días", () => {
    const q = quoteRecargoMora({
      baseAmount: "30.00",
      diasAtraso: 1,
      aplicar: true,
      config: activo("MONTO_FIJO", "5.00"),
    });
    expect(q).toMatchObject({ recargo: "5.00", total: "35.00" });
  });

  it("POR_DIA: 1.00/día × 5 días = 5.00", () => {
    const q = quoteRecargoMora({
      baseAmount: "30.00",
      diasAtraso: 5,
      aplicar: true,
      config: activo("POR_DIA", "1.00"),
    });
    expect(q).toMatchObject({ recargo: "5.00", total: "35.00" });
  });

  it("POR_DIA con tope: 1.00/día × 5, tope 3.00 → 3.00", () => {
    const q = quoteRecargoMora({
      baseAmount: "30.00",
      diasAtraso: 5,
      aplicar: true,
      config: activo("POR_DIA", "1.00", "3.00"),
    });
    expect(q.recargo).toBe("3.00");
    expect(q.total).toBe("33.00");
  });

  it("redondeo half-up: 33.33 base, 10% → 3.33", () => {
    const q = quoteRecargoMora({
      baseAmount: "33.33",
      diasAtraso: 2,
      aplicar: true,
      config: activo("PORCENTAJE", "10.00"),
    });
    expect(q.recargo).toBe("3.33");
  });
});

describe("quoteRecargoMora — no se aplica", () => {
  const cfg = activo("PORCENTAJE", "10.00");

  it("sin config → SIN_CONFIG y recargo 0", () => {
    const q = quoteRecargoMora({ baseAmount: "30.00", diasAtraso: 5, aplicar: true, config: null });
    expect(q).toMatchObject({ aplicado: false, recargo: "0.00", total: "30.00", motivo: "SIN_CONFIG" });
  });

  it("config inactiva → INACTIVO", () => {
    const q = quoteRecargoMora({
      baseAmount: "30.00", diasAtraso: 5, aplicar: true,
      config: { ...cfg, activo: false },
    });
    expect(q.motivo).toBe("INACTIVO");
    expect(q.recargo).toBe("0.00");
  });

  it("recepcionista no marcó → NO_APLICADO", () => {
    const q = quoteRecargoMora({ baseAmount: "30.00", diasAtraso: 5, aplicar: false, config: cfg });
    expect(q.motivo).toBe("NO_APLICADO");
  });

  it("sin atraso (0 días) → SIN_ATRASO, recargo 0", () => {
    const q = quoteRecargoMora({ baseAmount: "30.00", diasAtraso: 0, aplicar: true, config: cfg });
    expect(q.motivo).toBe("SIN_ATRASO");
    expect(q.recargo).toBe("0.00");
  });

  it("días negativos se tratan como sin atraso", () => {
    const q = quoteRecargoMora({ baseAmount: "30.00", diasAtraso: -3, aplicar: true, config: cfg });
    expect(q.motivo).toBe("SIN_ATRASO");
    expect(q.dias_atraso).toBe(0);
  });

  it("base negativa se rechaza", () => {
    expect(() =>
      quoteRecargoMora({ baseAmount: "-1.00", diasAtraso: 5, aplicar: true, config: cfg }),
    ).toThrow(RecargoMoraPolicyError);
  });
});
