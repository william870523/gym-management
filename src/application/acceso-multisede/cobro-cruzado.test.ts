import { describe, expect, it } from "bun:test";
import { cobrarPlanDeVisitante } from "./acceso-multisede.service";

/**
 * El cobro cruzado (M4c): el socio paga donde entrena, el efectivo se queda en
 * esa caja y el ingreso es de su sede.
 *
 * Lo que estas pruebas fijan es la mitad que no se ve: que el ingreso NO acaba
 * en la sede que cobró. Es el «ingreso mal atribuido» de §7.10, y el modo en
 * que se rompería no daría error en ninguna parte —el total seguiría
 * cuadrando—, así que hay que comprobarlo a propósito.
 */
const OESTE = "gym-oeste";
const CENTRO = "gym-centro";
const CUP = "moneda-cup";
const HOY = new Date("2026-08-17T00:00:00.000Z");
const AHORA = new Date("2026-08-17T15:00:00.000Z");
const COBRADOR = { userId: "u-rosa", nombre: "Rosa", rol: "reception", origen: "LOCAL_USER" };

function baseCon(cotizacion: any) {
  const eventos: Array<{ entidad: string; entidadId: string; fila: any }> = [];
  const pagos: any[] = [];
  const detalles: any[] = [];
  const asientos: any[] = [];
  const tesoreria: any[] = [];

  const tx: any = {
    clienteVisitanteCotizacion: { findFirst: async () => cotizacion },
    pagoCliente: {
      create: async ({ data }: any) => {
        pagos.push(data);
        return data;
      },
    },
    detallePago: {
      create: async ({ data }: any) => {
        detalles.push(data);
        return data;
      },
    },
    saldoEnlaceAsiento: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        asientos.push(data);
        return data;
      },
    },
  };
  return { tx, eventos, pagos, detalles, asientos, tesoreria };
}

const filaCotizacion = (extra: Record<string, unknown> = {}) => ({
  ci: "99090100009",
  gym_id_origen: CENTRO,
  plan_id: "plan-1",
  plan_codigo: "MEN",
  plan_nombre: "Mensual",
  moneda_id: CUP,
  precio_lista: "300.00",
  precio_final: "300.00",
  categoria_cliente: "NUEVO",
  cubre_hasta: new Date("2026-08-17T00:00:00.000Z"),
  mora_activo: false,
  mora_modo: null,
  mora_valor: null,
  mora_tope: null,
  cuota_numero: null,
  cuota_importe: null,
  cuota_fecha_exigible: null,
  calculada_al: new Date("2026-08-15T00:00:00.000Z"),
  is_deleted: false,
  ...extra,
});

const cobrar = (base: ReturnType<typeof baseCon>, extra: any = {}) =>
  cobrarPlanDeVisitante({
    tx: base.tx,
    ci: "99090100009",
    gymIdQueCobra: OESTE,
    cobradoPor: COBRADOR,
    accesoMultisedeVigente: true,
    tipoPagoId: "tp-efectivo",
    cuentaId: "caja-oeste",
    fechaNegocio: HOY,
    sourceDevice: "device-oeste",
    nowUtc: AHORA,
    pagoId: "pago-1",
    detalleId: "det-1",
    registrarEnTesoreria: async (p: any) => base.tesoreria.push(p),
    emitirEvento: async (entidad: string, _op: string, entidadId: string, fila: any) => {
      base.eventos.push({ entidad, entidadId, fila });
    },
    ...extra,
  });

describe("M4c · cobro cruzado del plan", () => {
  it("el ingreso es de la sede del socio y el efectivo de la que cobró", async () => {
    // La prueba que da sentido al corte entero.
    const base = baseCon(filaCotizacion());
    const r = await cobrar(base);

    expect(r.pago.gym_id).toBe(CENTRO);
    expect(r.pago.cobrado_en_gym_id).toBe(OESTE);
    expect(r.pago.monto_total).toBe("300.00");
    expect(r.decision.ingreso).toEqual({ tipo: "SEDE", gymId: CENTRO });

    expect(base.asientos).toHaveLength(1);
    expect(base.asientos[0].gym_id).toBe(OESTE);
    expect(base.asientos[0].acreedor_tipo).toBe("SEDE");
    expect(base.asientos[0].acreedor_gym_id).toBe(CENTRO);
    expect(base.asientos[0].monto).toBe("300.00");
  });

  it("el detalle sigue al ingreso y viaja sin cuenta", async () => {
    // Sin cuenta porque sería una caja de otra sede; con el `gym_id` del
    // ingreso porque los informes de la sede dueña cruzan pagos y detalles por
    // el mismo gimnasio y si no desaparecerían de ahí.
    const base = baseCon(filaCotizacion());
    await cobrar(base);
    expect(base.detalles[0].gym_id).toBe(CENTRO);
    expect(base.detalles[0].cuenta_id).toBeNull();
    expect(base.detalles[0].cantidad).toBe("300.00");
  });

  it("el efectivo se apunta en la caja de la sede que cobró", async () => {
    const base = baseCon(filaCotizacion());
    await cobrar(base);
    expect(base.tesoreria).toHaveLength(1);
    expect(base.tesoreria[0].pago_cliente_id).toBe("pago-1");
  });

  it("la mora se recalcula al cobrar, no viene sumada", async () => {
    const base = baseCon(
      filaCotizacion({
        cubre_hasta: new Date("2026-08-10T00:00:00.000Z"),
        mora_activo: true,
        mora_modo: "FIJO",
        mora_valor: "25.00",
      }),
    );
    const r = await cobrar(base);
    expect(r.importe.diasAtraso).toBe(7);
    expect(r.importe.recargoMora).toBe("25.00");
    expect(r.pago.monto_total).toBe("325.00");
  });

  it("las cuatro filas viajan: pago, detalle, asiento y su rastro", async () => {
    const base = baseCon(filaCotizacion());
    await cobrar(base);
    expect(base.eventos.map((e) => e.entidad)).toEqual([
      "pago_cliente",
      "detalle_pago",
      "saldo_enlace_asiento",
    ]);
    // Cada una con SU clave: deducirla del payload fue lo que atascó la cola
    // el 17-08 con el cobro del plus.
    const clave = (entidad: string) =>
      base.eventos.find((e) => e.entidad === entidad)!.entidadId;
    expect(clave("pago_cliente")).toBe("pago-1");
    expect(clave("detalle_pago")).toBe("det-1");
    expect(clave("saldo_enlace_asiento")).toBe("sae-pago-1");
  });

  it("sin método de pago no se cobra: el detalle no puede quedarse sin él", async () => {
    // `detalle_pago.tipo_pago_id` es obligatorio, y con razón: el detalle dice
    // CÓMO se pagó. Inventar un método metería en los informes un efectivo que
    // quizá fue tarjeta. Lo destapó la sonda HTTP del 17-08.
    const base = baseCon(filaCotizacion());
    await expect(cobrar(base, { tipoPagoId: null })).rejects.toThrow("método");
    expect(base.pagos).toHaveLength(0);
  });

  it("sin plus vigente no se cobra nada aquí", async () => {
    const base = baseCon(filaCotizacion());
    await expect(cobrar(base, { accesoMultisedeVigente: false })).rejects.toThrow();
    expect(base.pagos).toHaveLength(0);
    expect(base.asientos).toHaveLength(0);
    expect(base.tesoreria).toHaveLength(0);
  });

  it("sin cotización replicada no se cobra: se le manda a su sede", async () => {
    const base = baseCon(null);
    await expect(cobrar(base)).rejects.toThrow();
    expect(base.pagos).toHaveLength(0);
  });

  it("a un socio de esta misma sede no se le cobra por aquí", async () => {
    // No es cobro cruzado: es el cobro de siempre, con sus reglas de membresía.
    // Dejarlo pasar crearía un pago sin aplicar a su cobertura.
    const base = baseCon(filaCotizacion({ gym_id_origen: OESTE }));
    await expect(cobrar(base)).rejects.toThrow("camino corriente");
    expect(base.pagos).toHaveLength(0);
  });
});
