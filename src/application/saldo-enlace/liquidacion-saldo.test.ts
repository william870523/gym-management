import { describe, expect, it } from "bun:test";
import { decidirCobro } from "../../domain/cobro-por-cuenta-ajena-policy";
import { anotarAsiento, saldoDeLaSede } from "./saldo-enlace.service";
import {
  anularLiquidacion,
  liquidacionesDeLaSede,
  registrarLiquidacion,
} from "./liquidacion-saldo.service";

/**
 * M8 — liquidar el saldo. Se prueba por donde duele: que el pago baje el saldo
 * de verdad, que reintentar no lo baje dos veces, y que la fila y el asiento
 * cuenten lo mismo.
 */
const OESTE = "gym-oeste";
const CENTRO = "gym-centro";
const CUP = "moneda-cup";
const USD = "moneda-usd";
const HOY = new Date("2026-08-19T00:00:00.000Z");
const AHORA = new Date("2026-08-19T15:04:00.000Z");

const ACTOR = { userId: "u-duena", nombre: "Dueña de la cadena", rol: "owner" };

/** Doble mínimo de Prisma: dos arrays en memoria con los filtros que se usan. */
function baseVacia() {
  const asientos: any[] = [];
  const liquidaciones: any[] = [];
  const eventos: Array<{ entidad: string; fila: any }> = [];
  return {
    asientos,
    liquidaciones,
    eventos,
    emitirAsiento: async (fila: any) => {
      eventos.push({ entidad: "saldo_enlace_asiento", fila });
    },
    emitirLiquidacion: async (fila: any) => {
      eventos.push({ entidad: "saldo_liquidacion", fila });
    },
    tx: {
      saldoEnlaceAsiento: {
        findFirst: async ({ where }: any) =>
          asientos.find(
            (f) => f.gym_id === where.gym_id && f.clave_origen === where.clave_origen,
          ) ?? null,
        create: async ({ data }: any) => {
          asientos.push(data);
          return data;
        },
        findMany: async ({ where }: any) =>
          asientos.filter((f) => f.gym_id === where.gym_id && f.is_deleted === false),
      },
      saldoLiquidacion: {
        findFirst: async ({ where }: any) =>
          liquidaciones.find((f) => f.liquidacion_id === where.liquidacion_id) ?? null,
        create: async ({ data }: any) => {
          liquidaciones.push(data);
          return data;
        },
        findMany: async ({ where }: any) =>
          liquidaciones.filter((f) => f.gym_id === where.gym_id && f.is_deleted === false),
        update: async ({ where, data }: any) => {
          const fila = liquidaciones.find(
            (f) => f.liquidacion_id === where.liquidacion_id,
          );
          for (const [k, v] of Object.entries(data)) {
            fila[k] = (v as any)?.increment ? (fila[k] ?? 0) + (v as any).increment : v;
          }
          return fila;
        },
      },
    },
  };
}

const deudaDelPlan = decidirCobro({
  clase: "PLAN",
  gymIdQueCobra: OESTE,
  gymIdDelSocio: CENTRO,
});

/** Oeste cobró un plan de un socio de Centro: le debe ese dinero. */
async function conDeuda(base: ReturnType<typeof baseVacia>, monto = "300.00", moneda = CUP) {
  await anotarAsiento({
    tx: base.tx,
    nowUtc: AHORA,
    asiento: {
      asientoId: `asi-${moneda}-${monto}`,
      saldo: deudaDelPlan.saldo,
      monedaId: moneda,
      monto,
      origenTipo: "PAGO_CLIENTE",
      origenId: "pago-1",
      claveOrigen: `PAGO_CLIENTE:pago-${moneda}-${monto}`,
      claseCobro: "PLAN",
      ci: "99090100001",
      ocurridoAt: AHORA,
      fechaNegocio: HOY,
    },
    emitirEvento: base.emitirAsiento,
  });
}

const pedida = (extra: Record<string, unknown> = {}) => ({
  liquidacionId: "liq-1",
  deudorGymId: OESTE,
  acreedor: { tipo: "SEDE" as const, gymId: CENTRO },
  monedaId: CUP,
  monto: "120.00",
  fechaNegocio: HOY,
  ...extra,
});

describe("M8 · registrar la liquidación del saldo", () => {
  it("baja el saldo de verdad, anotando y no reescribiendo", async () => {
    const base = baseVacia();
    await conDeuda(base);

    const { resuelta } = await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });

    expect(resuelta.saldoAntes).toBe("300.00");
    expect(resuelta.saldoDespues).toBe("180.00");
    // El asiento original sigue intacto: se contraasienta, no se corrige.
    expect(base.asientos).toHaveLength(2);
    expect(base.asientos[0].monto).toBe("300.00");
    expect(base.asientos[1].sentido).toBe("DESHACE");
    // Y el saldo recalculado desde el libro dice lo mismo que la fila.
    const [linea] = await saldoDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(linea.saldo).toBe("180.00");
  });

  it("congela a quien la registró", async () => {
    // El libro de asientos no lleva autor: nació de cobros, donde el autor ya
    // estaba en el cobro. Una transferencia entre dos negocios sin nadie que
    // responda por ella no se puede aclarar seis meses después.
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida({ referencia: "TRF-9912" }),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const [fila] = base.liquidaciones;
    expect(fila.registrado_por_user_id).toBe("u-duena");
    expect(fila.registrado_por_nombre_snapshot).toBe("Dueña de la cadena");
    expect(fila.registrado_por_rol_snapshot).toBe("owner");
    expect(fila.referencia).toBe("TRF-9912");
  });

  it("reintentar con el mismo identificador no paga dos veces", async () => {
    // Quien no vio la confirmación vuelve a darle al botón. Sin esto, la sede
    // acabaría habiendo «liquidado» el doble de lo que transfirió.
    const base = baseVacia();
    await conDeuda(base);
    const uno = await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const dos = await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });

    expect(uno.yaEstaba).toBeFalse();
    expect(dos.yaEstaba).toBeTrue();
    expect(base.liquidaciones).toHaveLength(1);
    expect(base.asientos).toHaveLength(2);
    const [linea] = await saldoDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(linea.saldo).toBe("180.00");
  });

  it("el reintento contesta los mismos importes que la primera vez", async () => {
    // La base devuelve el Decimal como «550», sin decimales, y la primera
    // respuesta lo daba como «550.00». La misma liquidación contestando dos
    // textos distintos según cuántas veces se pulsó el botón.
    const base = baseVacia();
    await conDeuda(base);
    const uno = await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    // Como lo haría la base: el Decimal llega sin los ceros de la derecha.
    base.liquidaciones[0].saldo_antes = "300";
    base.liquidaciones[0].monto = "120";
    base.liquidaciones[0].saldo_despues = "180";
    const dos = await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    expect(dos.resuelta.saldoAntes).toBe(uno.resuelta.saldoAntes);
    expect(dos.resuelta.monto).toBe(uno.resuelta.monto);
    expect(dos.resuelta.saldoDespues).toBe(uno.resuelta.saldoDespues);
    expect(dos.resuelta.saldoDespues).toBe("180.00");
  });

  it("cada fila emite su evento: un dato sin su rastro es una divergencia", async () => {
    const base = baseVacia();
    await conDeuda(base);
    base.eventos.length = 0;
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    expect(base.eventos.map((e) => e.entidad)).toEqual([
      "saldo_enlace_asiento",
      "saldo_liquidacion",
    ]);
    // Los dos viajan con la sede DEUDORA: es la que sacó el dinero de su caja.
    expect(base.eventos.every((e) => e.fila.gym_id === OESTE)).toBeTrue();
  });

  it("la fila y su asiento apuntan el uno al otro", async () => {
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const [fila] = base.liquidaciones;
    const asiento = base.asientos[1];
    expect(fila.asiento_id).toBe(asiento.asiento_id);
    expect(asiento.origen_id).toBe(fila.liquidacion_id);
    // La columna deja de decir qué se cobró y pasa a decir por qué nace.
    expect(asiento.clase_cobro).toBe("LIQUIDACION");
  });

  it("no liquida una deuda que está en otra moneda", async () => {
    // Deber 300 CUP no se salda con 3 USD sin una tasa declarada.
    const base = baseVacia();
    await conDeuda(base);
    await expect(
      registrarLiquidacion({
        tx: base.tx,
        pedida: pedida({ monedaId: USD, monto: "3.00" }),
        actor: ACTOR,
        nowUtc: AHORA,
        emitirAsiento: base.emitirAsiento,
        emitirLiquidacion: base.emitirLiquidacion,
      }),
    ).rejects.toThrow(/No hay saldo pendiente/);
    expect(base.liquidaciones).toHaveLength(0);
    expect(base.asientos).toHaveLength(1);
  });

  it("pagar de más sin declararlo no deja rastro de ningún tipo", async () => {
    // Lo importante no es solo que falle: es que no quede el asiento sin su
    // fila, porque eso deja el saldo bajado y la transferencia sin autor.
    const base = baseVacia();
    await conDeuda(base);
    await expect(
      registrarLiquidacion({
        tx: base.tx,
        pedida: pedida({ monto: "500.00" }),
        actor: ACTOR,
        nowUtc: AHORA,
        emitirAsiento: base.emitirAsiento,
        emitirLiquidacion: base.emitirLiquidacion,
      }),
    ).rejects.toThrow(/declararlo/);
    expect(base.asientos).toHaveLength(1);
    expect(base.liquidaciones).toHaveLength(0);
  });

  it("sin autor no se registra: es dinero entre dos negocios", async () => {
    const base = baseVacia();
    await conDeuda(base);
    await expect(
      registrarLiquidacion({
        tx: base.tx,
        pedida: pedida(),
        actor: { userId: "  ", nombre: "", rol: "" },
        nowUtc: AHORA,
        emitirAsiento: base.emitirAsiento,
        emitirLiquidacion: base.emitirLiquidacion,
      }),
    ).rejects.toThrow(/quién registra/);
  });

  it("el historial devuelve lo liquidado con su acreedor legible", async () => {
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida({ nota: "Transferencia del viernes" }),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const filas = await liquidacionesDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(filas).toHaveLength(1);
    expect(filas[0].acreedor).toEqual({ tipo: "SEDE", gymId: CENTRO });
    expect(filas[0].saldo_antes).toBe("300.00");
    expect(filas[0].saldo_despues).toBe("180.00");
    expect(filas[0].nota).toBe("Transferencia del viernes");
    expect(filas[0].registrado_por.nombre).toBe("Dueña de la cadena");
  });

  it("dos monedas son dos deudas, y liquidar una no toca la otra", async () => {
    const base = baseVacia();
    await conDeuda(base, "300.00", CUP);
    await conDeuda(base, "50.00", USD);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida({ monto: "300.00" }),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const lineas = await saldoDeLaSede({ tx: base.tx, gymId: OESTE });
    const porMoneda = Object.fromEntries(lineas.map((l) => [l.monedaId, l.saldo]));
    expect(porMoneda[CUP]).toBe("0.00");
    expect(porMoneda[USD]).toBe("50.00");
  });

  // -------------------------------------------------------- la anulación

  it("anular devuelve la deuda sin borrar la transferencia", async () => {
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    expect((await saldoDeLaSede({ tx: base.tx, gymId: OESTE }))[0].saldo).toBe("180.00");

    const r = await anularLiquidacion({
      tx: base.tx,
      liquidacionId: "liq-1",
      motivo: "Se transfirió a la sede equivocada",
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });

    expect(r.saldoRestituido).toBe("120.00");
    // La deuda vuelve a estar donde estaba.
    expect((await saldoDeLaSede({ tx: base.tx, gymId: OESTE }))[0].saldo).toBe("300.00");
    // Y la transferencia sigue ahí, marcada: ocurrió de verdad.
    expect(base.liquidaciones).toHaveLength(1);
    expect(base.liquidaciones[0].estado).toBe("ANULADA");
    expect(base.liquidaciones[0].anulada_motivo).toBe("Se transfirió a la sede equivocada");
    expect(base.liquidaciones[0].anulada_por_nombre_snapshot).toBe("Dueña de la cadena");
    // Tres asientos: la deuda, el pago y el contraasiento. Ninguno reescrito.
    expect(base.asientos).toHaveLength(3);
    expect(base.asientos.map((a: any) => a.sentido)).toEqual([
      "GENERA",
      "DESHACE",
      "GENERA",
    ]);
  });

  it("anular exige motivo", async () => {
    // Una corrección de dinero entre dos negocios sin explicar es
    // indistinguible de un error.
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    await expect(
      anularLiquidacion({
        tx: base.tx,
        liquidacionId: "liq-1",
        motivo: "   ",
        actor: ACTOR,
        nowUtc: AHORA,
        emitirAsiento: base.emitirAsiento,
        emitirLiquidacion: base.emitirLiquidacion,
      }),
    ).rejects.toThrow(/motivo/);
    expect(base.asientos).toHaveLength(2);
  });

  it("anular dos veces no devuelve la deuda dos veces", async () => {
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const anular = () =>
      anularLiquidacion({
        tx: base.tx,
        liquidacionId: "liq-1",
        motivo: "Error de destino",
        actor: ACTOR,
        nowUtc: AHORA,
        emitirAsiento: base.emitirAsiento,
        emitirLiquidacion: base.emitirLiquidacion,
      });
    const uno = await anular();
    const dos = await anular();
    expect(uno.yaEstaba).toBeFalse();
    expect(dos.yaEstaba).toBeTrue();
    expect(base.asientos).toHaveLength(3);
    expect((await saldoDeLaSede({ tx: base.tx, gymId: OESTE }))[0].saldo).toBe("300.00");
  });

  it("una liquidación que no existe no se anula en silencio", async () => {
    const base = baseVacia();
    await expect(
      anularLiquidacion({
        tx: base.tx,
        liquidacionId: "liq-fantasma",
        motivo: "Da igual",
        actor: ACTOR,
        nowUtc: AHORA,
        emitirAsiento: base.emitirAsiento,
        emitirLiquidacion: base.emitirLiquidacion,
      }),
    ).rejects.toThrow(/no existe/);
  });

  it("anular deja liquidar otra vez la misma deuda", async () => {
    // Es el caso que motiva todo esto: se transfirió a quien no era, se anula, y
    // hay que poder pagarle al acreedor correcto.
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    await anularLiquidacion({
      tx: base.tx,
      liquidacionId: "liq-1",
      motivo: "Destino equivocado",
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const otra = await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida({ liquidacionId: "liq-2", monto: "300.00" }),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    expect(otra.resuelta.saldoAntes).toBe("300.00");
    expect(otra.resuelta.saldoDespues).toBe("0.00");
  });

  it("el historial marca la anulada y dice quién y por qué", async () => {
    const base = baseVacia();
    await conDeuda(base);
    await registrarLiquidacion({
      tx: base.tx,
      pedida: pedida(),
      actor: ACTOR,
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    await anularLiquidacion({
      tx: base.tx,
      liquidacionId: "liq-1",
      motivo: "Destino equivocado",
      actor: { userId: "u-dos", nombre: "Contabilidad central", rol: "admin" },
      nowUtc: AHORA,
      emitirAsiento: base.emitirAsiento,
      emitirLiquidacion: base.emitirLiquidacion,
    });
    const [fila] = await liquidacionesDeLaSede({ tx: base.tx, gymId: OESTE });
    expect(fila.anulada).toBeTrue();
    expect(fila.estado).toBe("ANULADA");
    expect(fila.anulada_motivo).toBe("Destino equivocado");
    // Quien la registró y quien la anuló son personas distintas, y las dos
    // quedan: es lo que permite auditar una corrección.
    expect(fila.registrado_por.nombre).toBe("Dueña de la cadena");
    expect(fila.anulada_por?.nombre).toBe("Contabilidad central");
  });
});
