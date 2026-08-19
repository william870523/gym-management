import { describe, expect, it } from "bun:test";
import { aplicarCobroCruzadoALaCobertura } from "./aplicar-cobro-cruzado";

/**
 * Aplicar el cobro cruzado a la cobertura del socio, en su sede (M4c).
 *
 * Lo que se fija aquí es que el socio que pagó en otra sede **acabe cubierto en
 * la suya**, y que la cola pueda reintentar sin regalarle un mes. Las dos cosas
 * fallan en silencio si no se comprueban: la primera deja al socio pagando y
 * apareciendo vencido; la segunda le regala cobertura cada vez que un evento se
 * reenvía.
 */
const CENTRO = "gym-centro";
const HOY = new Date("2026-08-17T00:00:00.000Z");
const AHORA = new Date("2026-08-17T15:00:00.000Z");

function baseCon(opciones: {
  membresia?: any;
  cuota?: any;
  siguienteCuota?: any;
  yaAplicado?: boolean;
}) {
  const eventos: Array<{ entidad: string; fila: any }> = [];
  const aplicaciones: any[] = [];
  const avisos: any[] = [];
  const cuotasPagadas: number[] = [];
  let membresia = opciones.membresia === undefined
    ? {
        membresia_id: "memb-1",
        ci: "99090100009",
        gym_id: CENTRO,
        estado: "ACTIVA",
        fecha_inicio: new Date("2026-07-20T00:00:00.000Z"),
        fecha_fin: new Date("2026-08-20T00:00:00.000Z"),
        duracion_dias_snapshot: 30,
        importe_pagado: "300.00",
        version: 1,
      }
    : opciones.membresia;

  const tx: any = {
    membresiaCliente: {
      findFirst: async () => membresia,
      update: async ({ data }: any) => {
        membresia = { ...membresia, ...data, version: (membresia.version ?? 1) + 1 };
        return membresia;
      },
    },
    membresiaCuota: {
      findFirst: async ({ where }: any) =>
        where?.estado === "PENDIENTE"
          ? (opciones.siguienteCuota ?? null)
          : (opciones.cuota ?? null),
      update: async ({ data }: any) => data,
    },
    avisoAdministracion: {
      create: async ({ data }: any) => {
        avisos.push(data);
        return data;
      },
    },
    pagoMembresiaAplicacion: {
      findFirst: async () => (opciones.yaAplicado ? { aplicacion_id: "pma-x" } : null),
      create: async ({ data }: any) => {
        aplicaciones.push(data);
        return data;
      },
    },
  };
  return { tx, eventos, aplicaciones, avisos, cuotasPagadas, membresiaActual: () => membresia };
}

const pago = (extra: Record<string, unknown> = {}) => ({
  pago_cliente_id: "pago-1",
  ci: "99090100009",
  gym_id: CENTRO,
  moneda_id: "moneda-cup",
  monto_total: "300.00",
  cuota_sufijo_snapshot: null,
  ...extra,
});

const aplicar = (base: ReturnType<typeof baseCon>, extra: Record<string, unknown> = {}) =>
  aplicarCobroCruzadoALaCobertura({
    tx: base.tx,
    pago: pago(extra),
    fechaNegocio: HOY,
    nowUtc: AHORA,
    sourceDevice: "CONCENTRADOR",
    emitirEvento: async (entidad: string, _op: string, _id: string, fila: any) => {
      base.eventos.push({ entidad, fila });
    },
  });

describe("M4c · el cobro cruzado llega a la cobertura del socio", () => {
  it("extiende la membresía encadenando desde el fin vigente, no desde hoy", async () => {
    // La misma regla que el cobro de la propia sede: pagar antes de tiempo no
    // regala días ni deja hueco.
    const base = baseCon({});
    const r = await aplicar(base);

    expect(r.aplicado).toBeTrue();
    if (r.aplicado) {
      expect(r.modo).toBe("PERIODO");
      expect(r.cubreHasta.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    }
    expect(base.membresiaActual().estado).toBe("ACTIVA");
  });

  it("suma lo cobrado a lo ya pagado de la membresía", async () => {
    const base = baseCon({});
    await aplicar(base);
    expect(base.membresiaActual().importe_pagado).toBe("600.00");
  });

  it("deja el asiento de aplicación, que es lo que lo hace idempotente", async () => {
    const base = baseCon({});
    await aplicar(base);
    expect(base.aplicaciones).toHaveLength(1);
    expect(base.aplicaciones[0].pago_cliente_id).toBe("pago-1");
    expect(base.aplicaciones[0].gym_id).toBe(CENTRO);
  });

  it("un reintento de la cola no regala otro mes", async () => {
    // Sin esto, cada reenvío del mismo evento extendería la cobertura otra vez.
    const base = baseCon({ yaAplicado: true });
    const r = await aplicar(base);
    expect(r.aplicado).toBeFalse();
    expect(base.aplicaciones).toHaveLength(0);
    expect(base.membresiaActual().fecha_fin.toISOString()).toBe(
      "2026-08-20T00:00:00.000Z",
    );
  });

  it("la membresía extendida viaja: si no, la sede dueña no la vería", async () => {
    const base = baseCon({});
    await aplicar(base);
    expect(base.eventos.map((e) => e.entidad)).toContain("membresia_cliente");
    expect(base.eventos.map((e) => e.entidad)).toContain("pago_membresia_aplicacion");
  });

  it("sin membresía viva no se inventa ninguna", async () => {
    // El socio pudo darse de baja entre que se replicó su cotización y llegó el
    // cobro. El dinero está registrado y su sede decidirá.
    const base = baseCon({ membresia: null });
    const r = await aplicar(base);
    expect(r.aplicado).toBeFalse();
    expect(base.aplicaciones).toHaveLength(0);
  });

  // ===== §5.4-ter: cobrar dos veces es un adelanto, no un conflicto =====

  it("renovar estando cubierto se aplica al periodo siguiente y deja aviso", async () => {
    // Decisión del dueño: «si pagó este mes en Centro y volvió a pagar en
    // Oeste, el de Oeste sería el mes siguiente». Bloquearlo habría dejado al
    // socio pagando sin recibir nada.
    const base = baseCon({});
    const r = await aplicar(base, { cobrado_en_gym_id: "gym-oeste" });

    expect(r.aplicado).toBeTrue();
    if (r.aplicado) expect(r.adelantado).toBeTrue();
    expect(base.avisos).toHaveLength(1);
    expect(base.avisos[0].tipo).toBe("COBRO_CRUZADO_ADELANTADO");
    // El aviso va a la bandeja de SU sede: es quien atenderá la reclamación.
    expect(base.avisos[0].gym_id).toBe(CENTRO);
    expect(base.avisos[0].mensaje).toContain("periodo siguiente");
  });

  it("renovar ya vencido no es adelanto y no molesta a nadie con un aviso", async () => {
    const base = baseCon({
      membresia: {
        membresia_id: "memb-1",
        ci: "99090100009",
        gym_id: CENTRO,
        estado: "ACTIVA",
        fecha_inicio: new Date("2026-06-20T00:00:00.000Z"),
        fecha_fin: new Date("2026-07-20T00:00:00.000Z"),
        duracion_dias_snapshot: 30,
        importe_pagado: "300.00",
        version: 1,
      },
    });
    const r = await aplicar(base);
    expect(r.aplicado).toBeTrue();
    if (r.aplicado) expect(r.adelantado).toBeFalse();
    expect(base.avisos).toHaveLength(0);
  });

  it("una cuota ya pagada se adelanta a la siguiente pendiente", async () => {
    const base = baseCon({
      cuota: { numero_cuota: 3, estado: "PAGADA", fecha_cobertura_fin: HOY },
      siguienteCuota: { numero_cuota: 4 },
    });
    const r = await aplicar(base, { cuota_sufijo_snapshot: "3" });
    expect(r.aplicado).toBeTrue();
    if (r.aplicado) expect(r.adelantado).toBeTrue();
    expect(base.avisos).toHaveLength(1);
    expect(base.avisos[0].mensaje).toContain("cuota 4");
  });

  it("si no queda cuota que adelantar, no se inventa ninguna", async () => {
    // Pagó de más y el plan está saldado. El dinero queda registrado y su sede
    // decide si lo devuelve; fabricar una cuota sería peor.
    const base = baseCon({
      cuota: { numero_cuota: 3, estado: "PAGADA", fecha_cobertura_fin: HOY },
      siguienteCuota: null,
    });
    const r = await aplicar(base, { cuota_sufijo_snapshot: "3" });
    expect(r.aplicado).toBeFalse();
    expect(base.avisos).toHaveLength(0);
  });

  it("un cobro sin sede o sin socio no aplica nada", async () => {
    const base = baseCon({});
    for (const roto of [{ gym_id: "" }, { ci: "  " }]) {
      const r = await aplicar(base, roto);
      expect(r.aplicado).toBeFalse();
    }
  });
});
