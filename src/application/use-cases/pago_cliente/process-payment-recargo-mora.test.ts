/**
 * Recargo por mora en el cobro remoto (docs/RECARGO_MORA.md).
 *
 * Verifica el cableo, no la fórmula (esa está en recargo-mora-policy.test.ts):
 *  - el cobro exigido pasa a ser base + recargo;
 *  - `monto_total` incluye el recargo;
 *  - el snapshot se congela en el detalle;
 *  - sin atraso / sin config / inactivo no se cobra recargo;
 *  - condonar exige motivo y deja rastro (docs/RECARGO_MORA.md §6-bis).
 */
import { describe, expect, it, mock } from "bun:test";
import { ProcessPaymentUseCase } from "./ProcessPaymentUseCase";

const HOY = new Date();
const diasAtras = (n: number) => {
  const d = new Date(HOY);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};

function build(opts: {
  planExtra?: Record<string, unknown>;
  fechaFin?: Date | null;
}) {
  const plan = {
    id_planes_pago: "plan-1",
    importe_plan_pago: 30,
    moneda_id: "CUP",
    activo: true,
    is_deleted: false,
    ...(opts.planExtra ?? {}),
  };
  const saved: any = {};
  const pagoClienteRepository = {
    processPayment: mock(async (pago: any, detalles: any[]) => {
      saved.pago = pago;
      saved.detalles = detalles;
    }),
    // El caso de uso relee el pago para devolver lo REALMENTE guardado: el
    // importe definitivo lo fija el servidor dentro de la transacción.
    findById: mock(async () => saved.pago ?? null),
  } as any;
  const planesPagoRepository = { findById: mock(async () => plan) } as any;
  const clienteRepository = {
    findById: mock(async () => ({ ci: "123", fecha_fin: opts.fechaFin ?? null })),
  } as any;

  // R5.6: el cobrador se resuelve por un puerto. Aquí se sustituye por uno
  // fijo para no depender de la base; lo que esta prueba mira es el recargo.
  const actorResolver = {
    resolve: mock(async () => ({
      userId: "user-recepcion",
      nombre: "Recepción de prueba",
      rol: "recepcionista",
      origen: "REMOTE_USER" as const,
    })),
  };

  const useCase = new ProcessPaymentUseCase(
    pagoClienteRepository,
    planesPagoRepository,
    clienteRepository,
    actorResolver,
    async () => ({
      precio_lista: "30.00",
      descuento_pct: null,
      descuento: "0.00",
      precio_final: "30.00",
      motivo: "SIN_DESCUENTO",
      categoria_cliente: "NUEVO",
      plan_codigo: "plan-1",
      plan_nombre: "Plan de prueba",
      cuota_sufijo: null,
    }),
  );
  return { useCase, saved, plan };
}

const baseInput = (
  montoTotal: number,
  condonar?: { motivo?: string },
) => ({
  ci: "123",
  id_planes_pago: "plan-1",
  moneda_id: "CUP",
  monto_total: montoTotal,
  detalles: [{ tipo_pago_id: "efectivo", moneda_id: "CUP", cantidad: montoTotal }],
  ...(condonar
    ? { condonar_recargo_mora: true, motivo_condonacion_recargo: condonar.motivo }
    : {}),
}) as any;

const PLAN_10PCT = {
  recargo_mora_modo: "PORCENTAJE",
  recargo_mora_valor: "10.00",
  recargo_mora_tope: null,
  recargo_mora_activo: true,
};

describe("ProcessPaymentUseCase — recargo por mora", () => {
  it("con atraso el recargo se aplica solo (política del administrador)", async () => {
    const { useCase, saved } = build({
      planExtra: PLAN_10PCT,
      fechaFin: diasAtras(5),
    });

    // 30.00 base + 3.00 (10%) = 33.00
    const pago = await useCase.execute(baseInput(33), "gym-1");

    expect(pago.monto_total).toBe(33);
    const detalle = saved.detalles[0];
    expect(detalle.recargo_mora_modo_snapshot).toBe("PORCENTAJE");
    expect(detalle.recargo_mora_importe).toBe("3.00");
    expect(detalle.recargo_mora_base).toBe("30.00");
    expect(detalle.recargo_mora_dias_atraso).toBe(5);
    expect(detalle.recargo_mora_plan_valor).toBe("10.00");
  });

  it("rechaza el cobro si solo se paga la base habiendo recargo", async () => {
    const { useCase } = build({ planExtra: PLAN_10PCT, fechaFin: diasAtras(5) });
    await expect(useCase.execute(baseInput(30), "gym-1")).rejects.toThrow(
      /requiere 33\.00/,
    );
  });

  it("condonar sin motivo se rechaza (no se perdona en silencio)", async () => {
    const { useCase } = build({ planExtra: PLAN_10PCT, fechaFin: diasAtras(5) });
    await expect(
      useCase.execute(baseInput(30, { motivo: "" }), "gym-1"),
    ).rejects.toThrow(/motivo/i);
  });

  it("condonar con motivo cobra solo la base y deja rastro", async () => {
    const { useCase, saved } = build({ planExtra: PLAN_10PCT, fechaFin: diasAtras(5) });
    const pago: any = await useCase.execute(
      baseInput(30, { motivo: "Socio hospitalizado, autorizado" }),
      "gym-1",
      "user-recepcion",
    );
    expect(pago.monto_total).toBe(30);
    expect(pago.recargo_mora_condonado_importe).toBe("3.00");
    expect(pago.recargo_mora_condonado_motivo).toBe("Socio hospitalizado, autorizado");
    expect(pago.recargo_mora_condonado_por).toBe("user-recepcion");
    // El detalle NO registra recargo cobrado: no se cobró.
    expect(saved.detalles[0].recargo_mora_importe).toBeNull();
  });

  it("condonar cuando no hay recargo se rechaza", async () => {
    const { useCase } = build({ planExtra: PLAN_10PCT, fechaFin: null });
    await expect(
      useCase.execute(baseInput(30, { motivo: "motivo válido aquí" }), "gym-1"),
    ).rejects.toThrow(/no hay recargo/i);
  });

  it("sin atraso no hay recargo aunque se marque", async () => {
    const { useCase, saved } = build({ planExtra: PLAN_10PCT, fechaFin: null });
    const pago = await useCase.execute(baseInput(30), "gym-1");
    expect(pago.monto_total).toBe(30);
    expect(saved.detalles[0].recargo_mora_modo_snapshot).toBeNull();
  });

  it("plan sin recargo configurado: cobro normal", async () => {
    const { useCase, saved } = build({ fechaFin: diasAtras(30) });
    const pago = await useCase.execute(baseInput(30), "gym-1");
    expect(pago.monto_total).toBe(30);
    expect(saved.detalles[0].recargo_mora_importe).toBeNull();
  });

  it("config inactiva no cobra recargo", async () => {
    const { useCase, saved } = build({
      planExtra: { ...PLAN_10PCT, recargo_mora_activo: false },
      fechaFin: diasAtras(5),
    });
    const pago = await useCase.execute(baseInput(30), "gym-1");
    expect(pago.monto_total).toBe(30);
    expect(saved.detalles[0].recargo_mora_importe).toBeNull();
  });

  it("POR_DIA con tope respeta el máximo", async () => {
    const { useCase, saved } = build({
      planExtra: {
        recargo_mora_modo: "POR_DIA",
        recargo_mora_valor: "1.00",
        recargo_mora_tope: "3.00",
        recargo_mora_activo: true,
      },
      fechaFin: diasAtras(10),
    });
    // 1.00/día × 10 = 10.00, pero el tope es 3.00 → total 33.00
    const pago = await useCase.execute(baseInput(33), "gym-1");
    expect(pago.monto_total).toBe(33);
    expect(saved.detalles[0].recargo_mora_importe).toBe("3.00");
  });
});
