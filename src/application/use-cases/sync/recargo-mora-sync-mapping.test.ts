/**
 * Sincronización de los campos de recargo por mora (docs/RECARGO_MORA.md).
 *
 * Los handlers dedicados mapean campo por campo, así que un campo nuevo que no
 * se añada explícitamente SE PIERDE al sincronizar. Este test fija ese
 * contrato: config del plan y snapshot del detalle deben viajar completos.
 */
import { describe, expect, it, mock } from "bun:test";
import { ApplyPlanesPagoEventUseCase } from "./ApplyPlanesPagoEventUseCase";
import { ApplyDetallePagoEventUseCase } from "./ApplyDetallePagoEventUseCase";
import { ApplyPagoClienteEventUseCase } from "./ApplyPagoClienteEventUseCase";

describe("sync de planes_pago — configuración de recargo por mora", () => {
  it("propaga modo, valor, tope y activo", async () => {
    let saved: any;
    const repo = {
      upsertPlanesPago: mock(async (data: any) => { saved = data; }),
      withTransaction: () => repo,
    } as any;

    await new ApplyPlanesPagoEventUseCase(repo).execute({
      eventId: "ev-1",
      entidadId: "plan-1",
      operacion: "INSERT",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: {
        nombre_plan_pago: "Plan con recargo",
        importe_plan_pago: 30,
        duracion_plan_pago: 30,
        activo: true,
        moneda_id: "CUP",
        recargo_mora_modo: "POR_DIA",
        recargo_mora_valor: "1.50",
        recargo_mora_tope: "10.00",
        recargo_mora_activo: true,
      },
    } as any);

    expect(saved.recargo_mora_modo).toBe("POR_DIA");
    expect(saved.recargo_mora_valor).toBe("1.50");
    expect(saved.recargo_mora_tope).toBe("10.00");
    expect(saved.recargo_mora_activo).toBe(true);
  });

  it("un plan sin recargo llega con nulos y activo false", async () => {
    let saved: any;
    const repo = {
      upsertPlanesPago: mock(async (data: any) => { saved = data; }),
      withTransaction: () => repo,
    } as any;

    await new ApplyPlanesPagoEventUseCase(repo).execute({
      eventId: "ev-2",
      entidadId: "plan-2",
      operacion: "INSERT",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: {
        nombre_plan_pago: "Plan sin recargo",
        importe_plan_pago: 20,
        duracion_plan_pago: 30,
        activo: true,
        moneda_id: "CUP",
      },
    } as any);

    expect(saved.recargo_mora_modo).toBeNull();
    expect(saved.recargo_mora_valor).toBeNull();
    expect(saved.recargo_mora_tope).toBeNull();
    expect(saved.recargo_mora_activo).toBe(false);
  });
});

describe("sync de detalle_pago — snapshot congelado del recargo", () => {
  it("propaga el snapshot completo", async () => {
    let saved: any;
    const repo = {
      upsertDetallePago: mock(async (data: any) => { saved = data; }),
      withTransaction: () => repo,
    } as any;

    await new ApplyDetallePagoEventUseCase(repo).execute({
      eventId: "ev-3",
      entidadId: "detalle-1",
      operacion: "INSERT",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: {
        pago_cliente_id: "pago-1",
        tipo_pago_id: "efectivo",
        moneda_id: "CUP",
        cantidad: 33,
        recargo_mora_modo_snapshot: "PORCENTAJE",
        recargo_mora_dias_atraso: 5,
        recargo_mora_base: "30.00",
        recargo_mora_importe: "3.00",
        recargo_mora_plan_valor: "10.00",
        recargo_mora_plan_tope: null,
      },
    } as any);

    expect(saved.recargo_mora_modo_snapshot).toBe("PORCENTAJE");
    expect(saved.recargo_mora_dias_atraso).toBe(5);
    expect(saved.recargo_mora_base).toBe("30.00");
    expect(saved.recargo_mora_importe).toBe("3.00");
    expect(saved.recargo_mora_plan_valor).toBe("10.00");
    expect(saved.recargo_mora_plan_tope).toBeNull();
  });

  it("histórico sin recargo conserva nulos (pre-recargo-mora)", async () => {
    let saved: any;
    const repo = {
      upsertDetallePago: mock(async (data: any) => { saved = data; }),
      withTransaction: () => repo,
    } as any;

    await new ApplyDetallePagoEventUseCase(repo).execute({
      eventId: "ev-4",
      entidadId: "detalle-2",
      operacion: "INSERT",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: {
        pago_cliente_id: "pago-2",
        tipo_pago_id: "efectivo",
        moneda_id: "CUP",
        cantidad: 30,
      },
    } as any);

    expect(saved.recargo_mora_modo_snapshot).toBeNull();
    expect(saved.recargo_mora_importe).toBeNull();
    expect(saved.recargo_mora_dias_atraso).toBeNull();
  });
});

describe("sync de pago_cliente — condonación del recargo", () => {
  it("propaga importe, motivo y quién condonó", async () => {
    let saved: any;
    const repo = {
      upsertPagoCliente: mock(async (data: any) => { saved = data; }),
      withTransaction: () => repo,
    } as any;

    await new ApplyPagoClienteEventUseCase(repo).execute({
      eventId: "ev-5",
      entidadId: "pago-3",
      operacion: "INSERT",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: {
        ci: "99080900001",
        fecha: "2026-07-25T05:45:04.087Z",
        monto_total: 30,
        id_planes_pago: "plan-1",
        moneda_id: "CUP",
        recargo_mora_condonado_importe: "3.00",
        recargo_mora_condonado_motivo: "Socio hospitalizado, autorizado",
        recargo_mora_condonado_por: "user-1",
      },
    } as any);

    // Sin estos tres campos el cierre remoto no puede mostrar la línea de
    // recargos condonados: el rastro se perdía al subir el cobro.
    expect(saved.recargo_mora_condonado_importe).toBe("3.00");
    expect(saved.recargo_mora_condonado_motivo).toBe(
      "Socio hospitalizado, autorizado",
    );
    expect(saved.recargo_mora_condonado_por).toBe("user-1");
  });

  it("un cobro sin condonación llega con nulos", async () => {
    let saved: any;
    const repo = {
      upsertPagoCliente: mock(async (data: any) => { saved = data; }),
      withTransaction: () => repo,
    } as any;

    await new ApplyPagoClienteEventUseCase(repo).execute({
      eventId: "ev-6",
      entidadId: "pago-4",
      operacion: "INSERT",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: {
        ci: "99080900002",
        fecha: "2026-07-25T05:45:04.087Z",
        monto_total: 30,
        id_planes_pago: "plan-1",
        moneda_id: "CUP",
      },
    } as any);

    expect(saved.recargo_mora_condonado_importe).toBeNull();
    expect(saved.recargo_mora_condonado_motivo).toBeNull();
    expect(saved.recargo_mora_condonado_por).toBeNull();
  });
});
