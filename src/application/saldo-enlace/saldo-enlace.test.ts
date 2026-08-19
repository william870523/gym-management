import { describe, expect, it } from "bun:test";
import { decidirCobro, reversoDe } from "../../domain/cobro-por-cuenta-ajena-policy";
import {
  anotarAsiento,
  dineroDelSaldo,
  saldoDeLaSede,
} from "./saldo-enlace.service";

/**
 * El libro del saldo entre partes. Se prueba por donde duele: que un reverso
 * lo deje en cero, que un reintento no duplique la deuda y que dos monedas no
 * se mezclen nunca.
 */
const OESTE = "gym-oeste";
const CENTRO = "gym-centro";
const CUP = "moneda-cup";
const USD = "moneda-usd";
const HOY = new Date("2026-08-17T00:00:00.000Z");
const AHORA = new Date("2026-08-17T15:04:00.000Z");

/** Doble mínimo de Prisma: un array en memoria con el filtro que se usa. */
function baseVacia() {
  const filas: any[] = [];
  const eventos: any[] = [];
  return {
    filas,
    eventos,
    emitirEvento: async (fila: any) => {
      eventos.push(fila);
    },
    tx: {
      saldoEnlaceAsiento: {
        findFirst: async ({ where }: any) =>
          filas.find(
            (f) =>
              f.gym_id === where.gym_id && f.clave_origen === where.clave_origen,
          ) ?? null,
        create: async ({ data }: any) => {
          filas.push(data);
          return data;
        },
        findMany: async ({ where }: any) =>
          filas.filter(
            (f) =>
              f.gym_id === where.gym_id &&
              f.is_deleted === false &&
              (!where.fecha_negocio?.lte ||
                f.fecha_negocio <= where.fecha_negocio.lte),
          ),
      },
    },
  };
}

const cobroDelPlan = decidirCobro({
  clase: "PLAN",
  gymIdQueCobra: OESTE,
  gymIdDelSocio: CENTRO,
});
const cobroDelPlus = decidirCobro({
  clase: "PLUS_MULTISEDE",
  gymIdQueCobra: OESTE,
  gymIdDelSocio: CENTRO,
});

const asiento = (extra: Partial<Parameters<typeof anotarAsiento>[0]["asiento"]> = {}) => ({
  asientoId: "asi-1",
  saldo: cobroDelPlan.saldo,
  monedaId: CUP,
  monto: "300.00",
  origenTipo: "PAGO_CLIENTE",
  origenId: "pago-1",
  claveOrigen: "PAGO_CLIENTE:pago-1",
  claseCobro: "PLAN",
  ci: "99090100001",
  ocurridoAt: AHORA,
  fechaNegocio: HOY,
  ...extra,
});

describe("M4b · libro del saldo entre partes", () => {
  it("un cobro por cuenta ajena deja a la sede debiendo al titular del ingreso", async () => {
    const base = baseVacia();
    await anotarAsiento({ tx: base.tx, asiento: asiento(), nowUtc: AHORA, emitirEvento: base.emitirEvento });

    const lineas = await saldoDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(lineas).toHaveLength(1);
    expect(lineas[0].acreedor).toEqual({ tipo: "SEDE", gymId: CENTRO });
    expect(lineas[0].saldo).toBe("300.00");
    expect(lineas[0].asientos).toBe(1);
  });

  it("el reverso lo deja en cero, y el rastro de las dos patas se conserva", async () => {
    // Que quede en cero no basta: hay que poder ver que hubo un cobro y una
    // devolución, no que nunca pasó nada (§7.8).
    const base = baseVacia();
    await anotarAsiento({ tx: base.tx, asiento: asiento(), nowUtc: AHORA, emitirEvento: base.emitirEvento });
    await anotarAsiento({
      tx: base.tx,
      asiento: asiento({
        asientoId: "asi-2",
        saldo: reversoDe(cobroDelPlan).saldo,
        origenTipo: "PAGO_REVERSION",
        origenId: "rev-1",
        claveOrigen: "PAGO_REVERSION:rev-1",
      }),
      nowUtc: AHORA,
      emitirEvento: base.emitirEvento,
    });

    const [linea] = await saldoDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(linea.saldo).toBe("0.00");
    expect(linea.generado).toBe("300.00");
    expect(linea.deshecho).toBe("300.00");
    expect(linea.asientos).toBe(2);
  });

  it("reintentar la misma operación no duplica la deuda", async () => {
    // La cola reenvía. Sin esta idempotencia, un reintento inventa dinero.
    const base = baseVacia();
    await anotarAsiento({ tx: base.tx, asiento: asiento(), nowUtc: AHORA, emitirEvento: base.emitirEvento });
    const repetido = await anotarAsiento({
      tx: base.tx,
      asiento: asiento({ asientoId: "asi-otro" }),
      nowUtc: AHORA,
      emitirEvento: base.emitirEvento,
    });

    expect(repetido.asiento_id).toBe("asi-1");
    expect(base.filas).toHaveLength(1);
    expect((await saldoDeLaSede({ tx: base.tx, gymId: OESTE }))[0].saldo).toBe(
      "300.00",
    );
  });

  it("la deuda con la cadena y la deuda con otra sede no se mezclan", async () => {
    const base = baseVacia();
    await anotarAsiento({ tx: base.tx, asiento: asiento(), nowUtc: AHORA, emitirEvento: base.emitirEvento });
    await anotarAsiento({
      tx: base.tx,
      asiento: asiento({
        asientoId: "asi-plus",
        saldo: cobroDelPlus.saldo,
        claseCobro: "PLUS_MULTISEDE",
        monto: "150.00",
        origenTipo: "COBRO_PLUS",
        origenId: "plus-1",
        claveOrigen: "COBRO_PLUS:plus-1",
      }),
      nowUtc: AHORA,
      emitirEvento: base.emitirEvento,
    });

    const lineas = await saldoDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.saldo)).toEqual(["150.00", "300.00"]);
    expect(lineas[0].acreedor).toEqual({ tipo: "CADENA" });
    expect(lineas[1].acreedor).toEqual({ tipo: "SEDE", gymId: CENTRO });
  });

  it("dos monedas son dos deudas, nunca un total mezclado", async () => {
    const base = baseVacia();
    await anotarAsiento({ tx: base.tx, asiento: asiento(), nowUtc: AHORA, emitirEvento: base.emitirEvento });
    await anotarAsiento({
      tx: base.tx,
      asiento: asiento({
        asientoId: "asi-usd",
        monedaId: USD,
        monto: "20.00",
        claveOrigen: "PAGO_CLIENTE:pago-usd",
        origenId: "pago-usd",
      }),
      nowUtc: AHORA,
      emitirEvento: base.emitirEvento,
    });

    const lineas = await saldoDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => [l.monedaId, l.saldo])).toEqual([
      [CUP, "300.00"],
      [USD, "20.00"],
    ]);
  });

  it("suma muchos asientos sin perder centavos", async () => {
    // El motivo de llevar el dinero en unidades mínimas y no en `number`:
    // 0.10 sumado mil veces en coma flotante deja de valer 100.00.
    const base = baseVacia();
    for (let i = 0; i < 1000; i += 1) {
      await anotarAsiento({
        tx: base.tx,
        asiento: asiento({
          asientoId: `asi-${i}`,
          monto: "0.10",
          origenId: `pago-${i}`,
          claveOrigen: `PAGO_CLIENTE:pago-${i}`,
        }),
        nowUtc: AHORA,
        emitirEvento: base.emitirEvento,
      });
    }
    expect((await saldoDeLaSede({ tx: base.tx, gymId: OESTE }))[0].saldo).toBe(
      "100.00",
    );
  });

  it("el corte por fecha de negocio deja fuera lo posterior", async () => {
    const base = baseVacia();
    await anotarAsiento({ tx: base.tx, asiento: asiento(), nowUtc: AHORA, emitirEvento: base.emitirEvento });
    await anotarAsiento({
      tx: base.tx,
      asiento: asiento({
        asientoId: "asi-manana",
        fechaNegocio: new Date("2026-08-18T00:00:00.000Z"),
        origenId: "pago-2",
        claveOrigen: "PAGO_CLIENTE:pago-2",
      }),
      nowUtc: AHORA,
      emitirEvento: base.emitirEvento,
    });

    const alDia = await saldoDeLaSede({
      tx: base.tx,
      gymId: OESTE,
      hastaFechaNegocio: HOY,
    });
    expect(alDia[0].saldo).toBe("300.00");
    expect((await saldoDeLaSede({ tx: base.tx, gymId: OESTE }))[0].saldo).toBe(
      "600.00",
    );
  });

  it("un cobro propio no puede anotar asiento", async () => {
    const propio = decidirCobro({
      clase: "PLAN",
      gymIdQueCobra: CENTRO,
      gymIdDelSocio: CENTRO,
    });
    const base = baseVacia();
    await expect(
      anotarAsiento({
        tx: base.tx,
        asiento: asiento({ saldo: propio.saldo }),
        nowUtc: AHORA,
        emitirEvento: base.emitirEvento,
      }),
    ).rejects.toThrow("no genera deuda entre partes");
  });

  it("rechaza importes no positivos o con formato inválido", async () => {
    const base = baseVacia();
    for (const monto of ["0.00", "-5.00", "", "abc", "1,50"]) {
      await expect(
        anotarAsiento({
          tx: base.tx,
          asiento: asiento({ monto }),
          nowUtc: AHORA,
          emitirEvento: base.emitirEvento,
        }),
      ).rejects.toThrow();
    }
    expect(base.filas).toHaveLength(0);
  });

  it("cada asiento escrito emite su evento, y el reintento no lo repite", async () => {
    // «Un dato sin su rastro, o un rastro sin su dato, es una divergencia
    // esperando turno.» El emisor es obligatorio en la firma justamente para
    // que no se pueda escribir un asiento y olvidar la cola. Y repetir el
    // evento de una fila que ya estaba metería en la cola el alta de algo que
    // existe, que es la otra mitad del mismo problema.
    const base = baseVacia();
    await anotarAsiento({
      tx: base.tx,
      asiento: asiento(),
      nowUtc: AHORA,
      emitirEvento: base.emitirEvento,
    });
    expect(base.eventos).toHaveLength(1);
    expect(base.eventos[0].asiento_id).toBe("asi-1");

    await anotarAsiento({
      tx: base.tx,
      asiento: asiento({ asientoId: "asi-otro" }),
      nowUtc: AHORA,
      emitirEvento: base.emitirEvento,
    });
    expect(base.eventos).toHaveLength(1);
  });

  it("si el asiento no se escribe, tampoco se emite el evento", async () => {
    const base = baseVacia();
    await expect(
      anotarAsiento({
        tx: base.tx,
        asiento: asiento({ monto: "-1.00" }),
        nowUtc: AHORA,
        emitirEvento: base.emitirEvento,
      }),
    ).rejects.toThrow();
    expect(base.filas).toHaveLength(0);
    expect(base.eventos).toHaveLength(0);
  });

  it("la conversión de dinero redondea hacia abajo lo que no cabe en centavos", () => {
    expect(dineroDelSaldo.aMinimas("1.005")).toBe(100n);
    expect(dineroDelSaldo.aTexto(100n)).toBe("1.00");
    expect(dineroDelSaldo.aTexto(-2550n)).toBe("-25.50");
  });
});
