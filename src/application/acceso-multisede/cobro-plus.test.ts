import { describe, expect, it } from "bun:test";
import { cobrarAccesoMultisede } from "./acceso-multisede.service";

/**
 * El cobro del plus (M4b). Se prueba por las tres cosas que tienen que pasar
 * juntas o no pasar: la vigencia se extiende encadenando, el cobro guarda qué
 * periodo compró, y la sede queda debiéndole ese dinero a la cadena.
 */
const SEDE = "gym-centro";
const OTRA = "gym-oeste";
const CUP = "moneda-cup";
const HOY = new Date("2026-08-17T00:00:00.000Z");
const AHORA = new Date("2026-08-17T15:00:00.000Z");
const COBRADOR = { userId: "u-rosa", nombre: "Rosa", rol: "reception", origen: "REMOTE_USER" };

function baseCon(opciones: { socio?: any; accesoPrevio?: any } = {}) {
  const eventos: Array<{ entidad: string; operacion: string; entidadId: string; fila: any }> = [];
  const tesoreria: any[] = [];
  const asientos: any[] = [];
  const cobros: any[] = [];
  let acceso = opciones.accesoPrevio ?? null;

  const tx: any = {
    cliente: {
      findFirst: async () =>
        opciones.socio === undefined ? { ci: "99090100001", gym_id: SEDE } : opciones.socio,
    },
    accesoMultisedePrecio: {
      findFirst: async () => ({ precio: "150.00", moneda_id: CUP }),
      findUnique: async () => ({ precio: "150.00", moneda_id: CUP }),
    },
    clienteAccesoMultisede: {
      findUnique: async () => acceso,
      upsert: async ({ create, update }: any) => {
        acceso = acceso ? { ...acceso, ...update, version: (acceso.version ?? 1) + 1 } : create;
        return acceso;
      },
    },
    accesoMultisedeCobro: {
      create: async ({ data }: any) => {
        cobros.push(data);
        return data;
      },
    },
    saldoEnlaceAsiento: {
      findFirst: async ({ where }: any) =>
        asientos.find((a) => a.clave_origen === where.clave_origen) ?? null,
      create: async ({ data }: any) => {
        asientos.push(data);
        return data;
      },
    },
  };

  return { tx, eventos, tesoreria, asientos, cobros, accesoActual: () => acceso };
}

const cobrar = (base: ReturnType<typeof baseCon>, extra: any = {}) =>
  cobrarAccesoMultisede({
    tx: base.tx,
    ci: "99090100001",
    gymIdQueCobra: SEDE,
    cobradoPor: COBRADOR,
    tipoPagoId: "tp-efectivo",
    cuentaId: "cuenta-caja",
    fechaNegocio: HOY,
    sourceDevice: "device-001",
    nowUtc: AHORA,
    cobroId: "cob-1",
    registrarEnTesoreria: async (cobro: any) => base.tesoreria.push(cobro),
    emitirEvento: async (
      entidad: string,
      operacion: string,
      entidadId: string,
      fila: any,
    ) => {
      base.eventos.push({ entidad, operacion, entidadId, fila });
    },
    ...extra,
  });

describe("M4b · cobro del plus multi-sede", () => {
  it("cobra, extiende la vigencia un mes y deja a la sede debiéndole a la cadena", async () => {
    const base = baseCon();
    const resultado = await cobrar(base);

    expect(resultado.cobro.importe).toBe("150.00");
    expect(resultado.cobro.cubre_desde).toEqual(HOY);
    expect(new Date(resultado.cobro.cubre_hasta).toISOString())
      .toBe("2026-09-17T00:00:00.000Z");

    // Lo importante: el ingreso NO es de la sede aunque el socio sea suyo.
    expect(resultado.decision.ingreso).toEqual({ tipo: "CADENA" });
    expect(base.asientos).toHaveLength(1);
    expect(base.asientos[0].acreedor_tipo).toBe("CADENA");
    expect(base.asientos[0].acreedor_gym_id).toBeNull();
    expect(base.asientos[0].monto).toBe("150.00");
    expect(base.asientos[0].gym_id).toBe(SEDE);
  });

  it("el periodo cobrado empieza donde termina el que ya cubría", async () => {
    // Renovar antes de que venza no regala días ni deja hueco: el comprobante
    // tiene que decir exactamente qué mes se compró.
    const base = baseCon({
      accesoPrevio: {
        cliente_acceso_multisede_id: "cam-x",
        activo: true,
        is_deleted: false,
        vigente_hasta: new Date("2026-10-01T00:00:00.000Z"),
        version: 1,
      },
    });
    const resultado = await cobrar(base);

    expect(new Date(resultado.cobro.cubre_desde).toISOString())
      .toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(resultado.cobro.cubre_hasta).toISOString())
      .toBe("2026-11-01T00:00:00.000Z");
  });

  it("un plus caducado no regala los días perdidos: se cobra desde hoy", async () => {
    const base = baseCon({
      accesoPrevio: {
        cliente_acceso_multisede_id: "cam-x",
        activo: true,
        is_deleted: false,
        vigente_hasta: new Date("2026-03-15T00:00:00.000Z"),
        version: 1,
      },
    });
    const resultado = await cobrar(base);
    expect(resultado.cobro.cubre_desde).toEqual(HOY);
  });

  it("el efectivo se apunta en la caja de la sede que cobró", async () => {
    const base = baseCon();
    await cobrar(base);
    expect(base.tesoreria).toHaveLength(1);
    expect(base.tesoreria[0].gym_id).toBe(SEDE);
    expect(base.tesoreria[0].cuenta_id).toBe("cuenta-caja");
  });

  it("las tres filas viajan: acceso, cobro y asiento", async () => {
    // Un dato sin su rastro es una divergencia esperando turno. Si alguna de
    // las tres se escribiera sin evento, la otra base no la vería nunca.
    const base = baseCon();
    await cobrar(base);
    expect(base.eventos.map((e) => e.entidad)).toEqual([
      "cliente_acceso_multisede",
      "acceso_multisede_cobro",
      "saldo_enlace_asiento",
    ]);

    // Y cada una con SU clave. `acceso_multisede_cobro` tiene una columna
    // `cliente_acceso_multisede_id`, así que deducir la clave del payload con
    // un `??` eligió la del acceso: el concentrador contestó «PK
    // contradictoria» y la cola se atascó detrás. Pasó de verdad el 17-08-2026.
    const clave = (entidad: string) =>
      base.eventos.find((e) => e.entidad === entidad)!.entidadId;
    expect(clave("acceso_multisede_cobro")).toBe("cob-1");
    expect(clave("saldo_enlace_asiento")).toBe("sae-cob-1");
    expect(clave("cliente_acceso_multisede")).not.toBe("cob-1");
  });

  it("la sede visitada no puede venderle el plus a un socio ajeno", async () => {
    // El plus lo vende su sede. Si lo vendiera la visitada, el ingreso de la
    // cadena entraría por una caja y la vigencia se escribiría sobre un socio
    // del que esa sede no sabe nada.
    const base = baseCon({ socio: { ci: "99090100009", gym_id: OTRA } });
    await expect(cobrar(base)).rejects.toThrow("lo vende la sede del socio");
    expect(base.cobros).toHaveLength(0);
    expect(base.asientos).toHaveLength(0);
    expect(base.tesoreria).toHaveLength(0);
  });

  it("sin socio no hay cobro", async () => {
    const base = baseCon({ socio: null });
    await expect(cobrar(base)).rejects.toThrow();
    expect(base.cobros).toHaveLength(0);
  });

  it("sin precio configurado no se cobra nada", async () => {
    // Falla cerrado: cobrar un cero implícito dejaría accesos gratuitos
    // pegados a socios reales y una deuda con la cadena de 0.00.
    const base = baseCon();
    base.tx.accesoMultisedePrecio.findFirst = async () => null;
    base.tx.accesoMultisedePrecio.findUnique = async () => null;
    await expect(cobrar(base)).rejects.toThrow();
    expect(base.cobros).toHaveLength(0);
    expect(base.asientos).toHaveLength(0);
  });
});
