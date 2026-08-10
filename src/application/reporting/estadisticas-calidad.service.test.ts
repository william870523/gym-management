import { describe, expect, it } from "bun:test";
import {
  ConsultaCalidadInvalida,
  EstadisticasCalidadService,
  severidadPorCobertura,
  UMBRALES_CALIDAD,
} from "./estadisticas-calidad.service";
import type {
  BajasCanonicas,
  EstadisticasCalidadReader,
  LecturaCalidadAsistencias,
  LecturaCalidadCobros,
  LecturaCalidadMembresias,
  LecturaCalidadSocios,
  RetencionBajasReader,
} from "./estadisticas-calidad.reader";

const HOY = new Date("2026-08-01T00:00:00.000Z");

interface Lecturas {
  socios?: Partial<LecturaCalidadSocios>;
  membresias?: Partial<LecturaCalidadMembresias>;
  asistencias?: Partial<LecturaCalidadAsistencias>;
  cobros?: Partial<LecturaCalidadCobros>;
  sinMotivo?: number;
}

class LectorFalso implements EstadisticasCalidadReader {
  public idsConsultados: string[] | null = null;

  constructor(private readonly lecturas: Lecturas = {}) {}

  async leerSocios(): Promise<LecturaCalidadSocios> {
    return {
      padron: 100,
      sinFechaNacimiento: 0,
      sinSexo: 0,
      variantesSexo: ["Femenino", "Masculino"],
      sinReferencia: 0,
      sinHorario: 0,
      ...this.lecturas.socios,
    };
  }

  async leerMembresias(): Promise<LecturaCalidadMembresias> {
    return {
      total: 200,
      solapadas: 0,
      fechasInvertidas: 0,
      sinPlanResoluble: 0,
      ...this.lecturas.membresias,
    };
  }

  async leerAsistencias(): Promise<LecturaCalidadAsistencias> {
    return {
      total: 3000,
      sinInstante: 0,
      abiertasAnomalas: 0,
      umbralHorasAbierta: 12,
      ...this.lecturas.asistencias,
    };
  }

  async leerCobros(): Promise<LecturaCalidadCobros> {
    return {
      total: 500,
      sinMoneda: 0,
      sinMedio: 0,
      sinCobrador: 0,
      ...this.lecturas.cobros,
    };
  }

  async contarBajasSinMotivo(
    _gymId: string,
    membresiaIds: string[],
  ): Promise<number> {
    this.idsConsultados = membresiaIds;
    return this.lecturas.sinMotivo ?? 0;
  }
}

class MotorFalso implements RetencionBajasReader {
  constructor(private readonly bajas: Partial<BajasCanonicas> = {}) {}

  async leerBajas(): Promise<BajasCanonicas> {
    return {
      membresiaIds: ["m1", "m2", "m3", "m4"],
      total: 4,
      sinGestion: 1,
      noLocalizadas: 1,
      corteMadurez: "2026-07-25",
      ...this.bajas,
    };
  }
}

function consultar(
  lecturas: Lecturas = {},
  motor?: RetencionBajasReader,
  dias = 90,
) {
  return new EstadisticasCalidadService(new LectorFalso(lecturas), motor)
    .calidad({
      gymId: "gym-1",
      zona: "America/Los_Angeles",
      hoy: HOY,
      dias,
    });
}

function buscar(resultado: any, id: string) {
  return resultado.controles.find((control: any) => control.id === id);
}

describe("panel de calidad de datos", () => {
  it("cada control publica su denominador y la regla con la que se juzgó", async () => {
    const resultado = await consultar({
      socios: { padron: 120, sinFechaNacimiento: 30 },
    });
    const control = buscar(resultado, "socios-fecha-nacimiento");
    expect(control).toMatchObject({
      afectados: 30,
      base: 120,
      coberturaPct: 75,
      severidad: "peligro",
    });
    expect(control.regla).toContain(`${UMBRALES_CALIDAD.coberturaAviso} %`);
    for (const fila of resultado.controles) {
      expect(fila.regla.length).toBeGreaterThan(0);
    }
  });

  it("la severidad sigue exactamente el umbral que publica", () => {
    expect(severidadPorCobertura(0, 100)).toBe("ok");
    expect(severidadPorCobertura(4, 100)).toBe("ok"); // 96 % de cobertura
    expect(severidadPorCobertura(6, 100)).toBe("aviso"); // 94 %
    expect(severidadPorCobertura(25, 100)).toBe("peligro"); // 75 %
    // Sin base no se inventa una severidad.
    expect(severidadPorCobertura(0, 0)).toBe("ok");
  });

  it("una incoherencia estructural es peligro con un solo caso", async () => {
    const resultado = await consultar({
      membresias: { total: 2000, fechasInvertidas: 1 },
    });
    const control = buscar(resultado, "membresias-fechas-invertidas");
    expect(control.severidad).toBe("peligro");
    expect(control.regla).toContain("No se gradúa por porcentaje");
    // Y sin casos, el mismo control queda en orden.
    const limpio = await consultar({});
    expect(buscar(limpio, "membresias-fechas-invertidas").severidad).toBe("ok");
  });

  it("el vocabulario del sexo no se mide por cobertura", async () => {
    const resultado = await consultar({
      socios: {
        padron: 107,
        variantesSexo: ["F", "Femenino", "M", "Masculino"],
      },
    });
    const control = buscar(resultado, "socios-sexo-vocabulario");
    expect(control.severidad).toBe("peligro");
    expect(control.afectados).toBe(1);
    expect(control.coberturaPct).toBeNull();
    expect(control.detalle).toContain("F, Femenino, M, Masculino");
  });

  it("lleva a Clientes ya filtrado solo cuando existe ese conjunto", async () => {
    const resultado = await consultar({
      socios: { padron: 100, sinReferencia: 12, sinHorario: 0 },
    });
    expect(buscar(resultado, "socios-referencia").destino).toEqual({
      tipo: "clientes",
      atributo: "referencia",
      valor: "SIN DATO",
    });
    // Sin socios afectados no hay lista a la que ir.
    expect(buscar(resultado, "socios-horario").destino).toBeNull();
    // Y donde no existe filtro, se dice que no hay destino en vez de fingirlo.
    expect(buscar(resultado, "socios-fecha-nacimiento").destino).toBeNull();
  });

  it("las bajas las cuenta el motor canónico y solo se les mira la gestión", async () => {
    const lector = new LectorFalso({ sinMotivo: 2 });
    const resultado = await new EstadisticasCalidadService(
      lector,
      new MotorFalso(),
    ).calidad({
      gymId: "gym-1",
      zona: "America/Los_Angeles",
      hoy: HOY,
      dias: 90,
    });
    expect(resultado.bajas).toMatchObject({
      evaluada: true,
      total: 4,
      corteMadurez: "2026-07-25",
    });
    // La lista de bajas llega decidida: el lector solo recibe los ids.
    expect(lector.idsConsultados).toEqual(["m1", "m2", "m3", "m4"]);
    expect(buscar(resultado, "bajas-sin-motivo")).toMatchObject({
      afectados: 2,
      base: 4,
    });
    expect(buscar(resultado, "bajas-sin-gestion").destino).toEqual({
      tipo: "retencion",
    });
  });

  it("sin motor canónico la familia bajas se declara no evaluada, no en cero", async () => {
    const resultado = await consultar({});
    expect(resultado.bajas.evaluada).toBe(false);
    expect(resultado.bajas.motivo).toContain("regla 11");
    expect(resultado.controles.some((c) => c.familia === "bajas")).toBe(false);
    expect(resultado.advertencias).toContain(resultado.bajas.motivo!);
  });

  it("no pide motivos cuando el motor no señaló ninguna baja", async () => {
    const lector = new LectorFalso();
    await new EstadisticasCalidadService(
      lector,
      new MotorFalso({ membresiaIds: [], total: 0, sinGestion: 0, noLocalizadas: 0 }),
    ).calidad({ gymId: "gym-1", zona: "America/Los_Angeles", hoy: HOY, dias: 90 });
    expect(lector.idsConsultados).toBeNull();
  });

  it("ordena lo más grave primero y resume el recuento por severidad", async () => {
    const resultado = await consultar({
      socios: { padron: 100, sinFechaNacimiento: 40, sinSexo: 6 },
      cobros: { total: 500, sinMoneda: 3 },
    });
    expect(resultado.controles[0]!.severidad).toBe("peligro");
    const severidades = resultado.controles.map((c) => c.severidad);
    expect(severidades.indexOf("ok")).toBeGreaterThan(
      severidades.lastIndexOf("peligro"),
    );
    expect(resultado.resumen.total).toBe(resultado.controles.length);
    expect(
      resultado.resumen.peligro + resultado.resumen.aviso + resultado.resumen.ok,
    ).toBe(resultado.controles.length);
  });

  it("declara que el período solo acota las bajas", async () => {
    const resultado = await consultar({});
    expect(resultado.periodo.aplicaA).toBe("bajas");
    expect(resultado.bases.padron).toBe(100);
  });

  it("rechaza períodos que no existen", async () => {
    await expect(consultar({}, undefined, 45)).rejects.toBeInstanceOf(
      ConsultaCalidadInvalida,
    );
  });
});
