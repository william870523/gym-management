import { describe, expect, it } from "bun:test";
import {
  ConsultaSegmentacionInvalida,
  EstadisticasSegmentacionService,
  MUESTRA_MINIMA,
  resolverCompatibilidad,
} from "./estadisticas-segmentacion.service";
import {
  DIMENSIONES,
  MEDIDAS,
  type ConsultaSegmentacion,
  type EstadisticasSegmentacionReader,
  type FilaSegmentacion,
} from "./estadisticas-segmentacion.reader";

function servicio(filas: FilaSegmentacion[] = []) {
  const consultas: ConsultaSegmentacion[] = [];
  const reader: EstadisticasSegmentacionReader = {
    async leerSegmentacion(consulta) {
      consultas.push(consulta);
      return filas;
    },
  };
  return { consultas, service: new EstadisticasSegmentacionService(reader) };
}

const base = {
  gymId: "gym",
  zona: "America/Havana",
  hoy: new Date("2026-07-30T00:00:00.000Z"),
  dias: 90,
};

describe("qué se puede cruzar con qué", () => {
  it("las dimensiones del socio valen para todas las medidas", () => {
    for (const medida of MEDIDAS) {
      expect(resolverCompatibilidad("sexo", medida).compatible).toBe(true);
      expect(resolverCompatibilidad("plan", medida).compatible).toBe(true);
    }
  });

  it("una visita no tiene medio de pago, y se dice en vez de devolver cero", () => {
    const salida = resolverCompatibilidad("tipo_pago", "asistencias");
    expect(salida.compatible).toBe(false);
    if (!salida.compatible) {
      expect(salida.motivo).toContain("dato del cobro");
      expect(salida.motivo).toContain("Un socio no tiene medio de pago");
    }
    expect(resolverCompatibilidad("moneda", "padron").compatible).toBe(false);
    expect(resolverCompatibilidad("cobrador", "altas").compatible).toBe(false);
  });

  it("el ingreso baja al detalle cuando la dimensión vive ahí", () => {
    const porPlan = resolverCompatibilidad("plan", "ingreso");
    expect(porPlan).toEqual({ compatible: true, fuente: "pago" });
    const porMedio = resolverCompatibilidad("tipo_pago", "ingreso");
    expect(porMedio).toEqual({ compatible: true, fuente: "detalle" });
  });

  it("el ticket medio no se reparte entre los movimientos de un cobro mixto", () => {
    const salida = resolverCompatibilidad("tipo_pago", "ticketMedio");
    expect(salida.compatible).toBe(false);
    if (!salida.compatible) {
      expect(salida.motivo).toContain("cobro mixto");
    }
    expect(resolverCompatibilidad("cuenta", "descuento").compatible).toBe(false);
  });

  it("el recargo de mora sí vive en el detalle y se cruza con todo", () => {
    for (const dimension of DIMENSIONES) {
      expect(resolverCompatibilidad(dimension, "recargoMora").compatible).toBe(
        true,
      );
    }
  });
});

describe("EstadisticasSegmentacionService", () => {
  it("ordena, calcula participación y publica la definición de la medida", async () => {
    const { service, consultas } = servicio([
      { clave: "F", etiqueta: "Femenino", valor: 30, numerador: null, denominador: null },
      { clave: "M", etiqueta: "Masculino", valor: 70, numerador: null, denominador: null },
    ]);

    const salida = await service.cruzar({
      ...base,
      dimension: "sexo",
      medida: "asistencias",
    });

    expect(salida.compatible).toBe(true);
    expect(salida.total).toBe(100);
    expect(salida.filas.map((f) => f.etiqueta)).toEqual([
      "Masculino",
      "Femenino",
    ]);
    expect(salida.filas[0]?.participacion).toBe(70);
    expect(salida.definicion).toContain("Visitas registradas");
    expect(salida.periodo).toEqual({
      dias: 90,
      desde: "2026-05-02",
      hasta: "2026-07-30",
      aplica: true,
    });
    expect(consultas[0]?.fuente).toBe("asistencia");
  });

  it("el padrón es un stock y lo declara: el período no lo recorta", async () => {
    const { service } = servicio([
      { clave: "NUEVO", etiqueta: "NUEVO", valor: 84, numerador: null, denominador: null },
    ]);
    const salida = await service.cruzar({
      ...base,
      dimension: "categoria",
      medida: "padron",
    });
    expect(salida.periodo.aplica).toBe(false);
  });

  it("una tasa lleva su denominador, avisa de muestra baja y no reparte porcentajes", async () => {
    const { service } = servicio([
      { clave: "p1", etiqueta: "Mensual", valor: 4, numerador: 40, denominador: 10 },
      { clave: "p2", etiqueta: "Diario", valor: 9, numerador: 27, denominador: 3 },
    ]);

    const salida = await service.cruzar({
      ...base,
      dimension: "plan",
      medida: "visitasPorSocio",
    });

    expect(salida.total).toBeNull();
    expect(salida.filas[0]).toMatchObject({
      etiqueta: "Diario",
      valor: 9,
      denominador: 3,
      muestraBaja: true,
      participacion: null,
    });
    expect(salida.filas[1]?.muestraBaja).toBe(false);
    expect(MUESTRA_MINIMA).toBe(5);
  });

  it("redondea el ruido de coma flotante para que los dos motores digan lo mismo", async () => {
    // Lo que devolvió MariaDB sumando DECIMAL, frente al 314442 de SQLite.
    const { service } = servicio([
      {
        clave: "efectivo",
        etiqueta: "Efectivo",
        valor: 314442.00000000006,
        numerador: null,
        denominador: null,
      },
    ]);
    const salida = await service.cruzar({
      ...base,
      dimension: "tipo_pago",
      medida: "ingreso",
      monedaId: "cup-1",
    });
    expect(salida.filas[0]?.valor).toBe(314442);
    expect(salida.total).toBe(314442);
  });

  it("una combinación imposible sale vacía y explicada, no en cero", async () => {
    const { service, consultas } = servicio();
    const salida = await service.cruzar({
      ...base,
      dimension: "cobrador",
      medida: "asistencias",
    });

    expect(salida.compatible).toBe(false);
    expect(salida.filas).toEqual([]);
    expect(salida.motivo).toContain("dato del cobro");
    // Ni siquiera se consulta la base: no hay nada que preguntar.
    expect(consultas).toHaveLength(0);
  });

  it("el dinero exige moneda, salvo cuando la moneda es el propio eje", async () => {
    const { service } = servicio([]);
    await expect(
      service.cruzar({ ...base, dimension: "plan", medida: "ingreso" }),
    ).rejects.toBeInstanceOf(ConsultaSegmentacionInvalida);

    const porMoneda = await service.cruzar({
      ...base,
      dimension: "moneda",
      medida: "ingreso",
    });
    expect(porMoneda.compatible).toBe(true);
    expect(porMoneda.monedaId).toBeNull();

    const conFiltro = await service.cruzar({
      ...base,
      dimension: "plan",
      medida: "ingreso",
      monedaId: "cup-1",
    });
    expect(conFiltro.monedaId).toBe("cup-1");
  });

  it("rechaza dimensión, medida y período inventados", async () => {
    const { service } = servicio();
    for (const consulta of [
      { dimension: "signo_zodiacal", medida: "padron", dias: 90 },
      { dimension: "sexo", medida: "karma", dias: 90 },
      { dimension: "sexo", medida: "padron", dias: 7 },
    ]) {
      await expect(
        service.cruzar({ ...base, ...consulta } as any),
      ).rejects.toBeInstanceOf(ConsultaSegmentacionInvalida);
    }
  });

  it("exporta CSV auditable con la definición, el denominador y el motivo", async () => {
    const { service } = servicio([
      { clave: "cup-1", etiqueta: "Peso cubano", valor: 12000, numerador: null, denominador: null },
    ]);
    const salida = await service.exportarCsv({
      ...base,
      dimension: "moneda",
      medida: "ingreso",
    });

    expect(salida.contenido.startsWith("﻿")).toBe(true);
    expect(salida.contenido).toContain('"participacion_porcentual"');
    expect(salida.contenido).toContain('"Peso cubano","12000"');
    expect(salida.nombreArchivo).toBe(
      "segmentacion-ingreso-por-moneda-2026-05-02-a-2026-07-30.csv",
    );
  });

  it("el CSV de una combinación imposible sale con su motivo y sin filas", async () => {
    const { service } = servicio();
    const salida = await service.exportarCsv({
      ...base,
      dimension: "tipo_pago",
      medida: "asistencias",
    });
    expect(salida.total).toBe(0);
    expect(salida.contenido.split("\r\n")).toHaveLength(1);
  });
});
