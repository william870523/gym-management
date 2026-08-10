import { describe, expect, it } from "bun:test";
import {
  EstadisticasCohortesService,
  ConsultaCohortesInvalida,
  semanaIso,
} from "./estadisticas-cohortes.service";
import type {
  AltaCohorte,
  EstadisticasCohortesReader,
  HistoriaCanonica,
  HistoriaCanonicaSocio,
  RetencionHistoriaReader,
} from "./estadisticas-cohortes.reader";

const HOY = new Date("2026-08-01T00:00:00.000Z");

class LectorFalso implements EstadisticasCohortesReader {
  public llamadasAltas = 0;

  constructor(
    private readonly altas: AltaCohorte[],
    private readonly sinAlta = 0,
  ) {}

  async leerAltas(): Promise<AltaCohorte[]> {
    this.llamadasAltas += 1;
    return this.altas;
  }

  async contarSociosSinAlta(): Promise<number> {
    return this.sinAlta;
  }
}

class MotorFalso implements RetencionHistoriaReader {
  public llamadas = 0;

  constructor(
    private readonly socios: HistoriaCanonicaSocio[],
    private readonly corteMadurez = "2026-07-25",
  ) {}

  async leerHistoria(): Promise<HistoriaCanonica> {
    this.llamadas += 1;
    return {
      socios: this.socios,
      corteMadurez: this.corteMadurez,
      diasGracia: 7,
      advertencias: ["aviso del motor"],
    };
  }
}

function alta(ci: string, dia: string): AltaCohorte {
  return { ci, nombre: `Socio ${ci}`, dia };
}

function consulta(
  reader: EstadisticasCohortesReader,
  motor?: RetencionHistoriaReader,
  granularidad = "mes",
) {
  return new EstadisticasCohortesService(reader, motor).cohortes({
    gymId: "gym-1",
    zona: "America/Los_Angeles",
    hoy: HOY,
    dias: 365,
    granularidad,
  });
}

describe("cohortes de alta", () => {
  it("la supervivencia la decide el motor, no la base de altas", async () => {
    // Las dos consultas comparten exactamente las mismas altas. Lo único que
    // cambia es lo que dice el motor canónico, y el resultado cambia con él:
    // esa es la prueba de que aquí no se reclasifica a nadie.
    const altas = [alta("A", "2026-03-02"), alta("B", "2026-03-03")];

    const sinSalidas = await consulta(
      new LectorFalso(altas),
      new MotorFalso([]),
    );
    const conSalida = await consulta(
      new LectorFalso(altas),
      new MotorFalso([
        { ci: "A", diaPrimeraSalida: "2026-03-20", diaPrimeraRenovacion: null },
      ]),
    );

    const h30 = (resultado: any) =>
      resultado.cohortes[0].horizontes.find((h: any) => h.dias === 30);
    expect(h30(sinSalidas)).toMatchObject({
      maduras: 2,
      retenidas: 2,
      bajas: 0,
      tasaPct: 100,
    });
    expect(h30(conSalida)).toMatchObject({
      maduras: 2,
      retenidas: 1,
      bajas: 1,
      tasaPct: 50,
    });
  });

  it("una salida posterior al corte no cuenta contra ese horizonte", async () => {
    // Salió el día 40; a los 30 seguía dentro y a los 60 ya no.
    const resultado = await consulta(
      new LectorFalso([alta("A", "2026-03-01")]),
      new MotorFalso([
        { ci: "A", diaPrimeraSalida: "2026-04-10", diaPrimeraRenovacion: null },
      ]),
    );
    const horizontes = resultado.cohortes[0]!.horizontes;
    expect(horizontes.find((h) => h.dias === 30)).toMatchObject({
      retenidas: 1,
      bajas: 0,
    });
    expect(horizontes.find((h) => h.dias === 60)).toMatchObject({
      retenidas: 0,
      bajas: 1,
    });
  });

  it("un horizonte que el motor aún no pudo decidir se declara abierto, no cero", async () => {
    // Alta del 20 de julio con corte de madurez el 25: ni los 30 días han
    // podido cerrarse.
    const resultado = await consulta(
      new LectorFalso([alta("A", "2026-07-20")]),
      new MotorFalso([], "2026-07-25"),
    );
    const h30 = resultado.cohortes[0]!.horizontes.find((h) => h.dias === 30)!;
    expect(h30.maduras).toBe(0);
    expect(h30.abiertas).toBe(1);
    expect(h30.tasaPct).toBeNull();
    expect(h30.bajas).toBe(0);
  });

  it("una salida anterior al alta no se le imputa a la cohorte", async () => {
    // Pertenece a una vida anterior del socio; ésta es su primera alta.
    const resultado = await consulta(
      new LectorFalso([alta("A", "2026-03-01")]),
      new MotorFalso([
        { ci: "A", diaPrimeraSalida: "2026-01-15", diaPrimeraRenovacion: null },
      ]),
    );
    expect(
      resultado.cohortes[0]!.horizontes.find((h) => h.dias === 30),
    ).toMatchObject({ retenidas: 1, bajas: 0 });
  });

  it("agrupa por mes y por semana ISO con el mismo padrón", async () => {
    const altas = [
      alta("A", "2026-03-02"), // lunes, semana 10
      alta("B", "2026-03-04"), // misma semana
      alta("C", "2026-03-09"), // semana 11
    ];
    const porMes = await consulta(new LectorFalso(altas), new MotorFalso([]));
    expect(porMes.cohortes).toHaveLength(1);
    expect(porMes.cohortes[0]).toMatchObject({
      clave: "2026-03",
      etiqueta: "mar 2026",
      inicio: "2026-03-01",
      fin: "2026-03-31",
      altas: 3,
    });

    const porSemana = await consulta(
      new LectorFalso(altas),
      new MotorFalso([]),
      "semana",
    );
    expect(porSemana.cohortes.map((c) => [c.clave, c.altas])).toEqual([
      ["2026-W10", 2],
      ["2026-W11", 1],
    ]);
    expect(porSemana.cohortes[0]!.inicio).toBe("2026-03-02");
  });

  it("la semana ISO respeta el cambio de año", () => {
    // El 31-12-2025 es miércoles: pertenece a la semana 1 de 2026.
    expect(semanaIso("2025-12-31")).toEqual({
      clave: "2026-W01",
      inicio: "2025-12-29",
    });
    expect(semanaIso("2026-01-04")).toEqual({
      clave: "2026-W01",
      inicio: "2025-12-29",
    });
    expect(semanaIso("2026-01-05").clave).toBe("2026-W02");
  });

  it("marca muestra baja por debajo de cinco maduras y publica el denominador", async () => {
    const resultado = await consulta(
      new LectorFalso([alta("A", "2026-03-01"), alta("B", "2026-03-02")]),
      new MotorFalso([]),
    );
    const h30 = resultado.cohortes[0]!.horizontes.find((h) => h.dias === 30)!;
    expect(h30.muestraBaja).toBe(true);
    expect(h30.maduras).toBe(2);
  });

  it("mide la mediana de días hasta la baja y hasta la primera renovación", async () => {
    const resultado = await consulta(
      new LectorFalso([
        alta("A", "2026-03-01"),
        alta("B", "2026-03-01"),
        alta("C", "2026-03-01"),
      ]),
      new MotorFalso([
        { ci: "A", diaPrimeraSalida: "2026-03-11", diaPrimeraRenovacion: null },
        { ci: "B", diaPrimeraSalida: "2026-03-31", diaPrimeraRenovacion: "2026-03-21" },
        { ci: "C", diaPrimeraSalida: null, diaPrimeraRenovacion: "2026-04-01" },
      ]),
    );
    expect(resultado.cohortes[0]!.tiempoHastaBaja).toEqual({
      socios: 2,
      base: 3,
      medianaDias: 20,
    });
    expect(resultado.cohortes[0]!.primeraRenovacion).toEqual({
      socios: 2,
      base: 3,
      medianaDias: 25.5,
    });
  });

  it("suma los totales sobre el padrón entero, no sobre las cohortes ya recortadas", async () => {
    const resultado = await consulta(
      new LectorFalso([
        alta("A", "2026-03-01"),
        alta("B", "2026-04-01"),
        alta("C", "2026-05-01"),
      ]),
      new MotorFalso([
        { ci: "B", diaPrimeraSalida: "2026-04-20", diaPrimeraRenovacion: null },
      ]),
    );
    expect(resultado.cohortes).toHaveLength(3);
    expect(resultado.totales!.altas).toBe(3);
    expect(resultado.totales!.horizontes[0]).toMatchObject({
      dias: 30,
      maduras: 3,
      retenidas: 2,
      bajas: 1,
    });
  });

  it("sin motor canónico se declara no disponible, no vacío", async () => {
    const lector = new LectorFalso([alta("A", "2026-03-01")]);
    const resultado = await consulta(lector, undefined);
    expect(resultado.disponible).toBe(false);
    expect(resultado.motivo).toContain("motor canónico");
    expect(resultado.cohortes).toEqual([]);
    // Ni siquiera se consulta la base: sin quien decida la supervivencia, las
    // altas por sí solas no significan nada.
    expect(lector.llamadasAltas).toBe(0);
  });

  it("declara los socios sin alta identificable en vez de repartirlos", async () => {
    const resultado = await consulta(
      new LectorFalso([alta("A", "2026-03-01")], 4),
      new MotorFalso([]),
    );
    expect(resultado.cobertura!.sociosSinAltaIdentificable).toBe(4);
    expect(resultado.advertencias.some((a) => a.includes("4 socio(s)"))).toBe(
      true,
    );
  });

  it("conserva las advertencias que publica el propio motor", async () => {
    const resultado = await consulta(
      new LectorFalso([alta("A", "2026-03-01")]),
      new MotorFalso([]),
    );
    expect(resultado.advertencias).toContain("aviso del motor");
    expect(resultado.politica).toEqual({
      diasGracia: 7,
      corteMadurez: "2026-07-25",
    });
  });

  it("rechaza períodos y granularidades que no existen", async () => {
    const servicio = new EstadisticasCohortesService(
      new LectorFalso([]),
      new MotorFalso([]),
    );
    await expect(
      servicio.cohortes({
        gymId: "gym-1",
        zona: "America/Los_Angeles",
        hoy: HOY,
        dias: 45,
        granularidad: "mes",
      }),
    ).rejects.toBeInstanceOf(ConsultaCohortesInvalida);
    await expect(
      servicio.cohortes({
        gymId: "gym-1",
        zona: "America/Los_Angeles",
        hoy: HOY,
        dias: 90,
        granularidad: "trimestre",
      }),
    ).rejects.toBeInstanceOf(ConsultaCohortesInvalida);
  });
});
