import { describe, expect, it } from "bun:test";
import {
  ApplyPagoClienteEventUseCase,
  AtribucionDeCobroError,
} from "./ApplyPagoClienteEventUseCase";

/**
 * M4c — **el ingreso no se reescribe al subir.**
 *
 * Hasta este corte, la subida sellaba `gym_id` con la sede del dispositivo sin
 * preguntar. Con el cobro cruzado eso deja de ser una simplificación y pasa a
 * ser la avería más cara que nombra docs/MULTI_SEDE.md §7.10: un cobro hecho en
 * Oeste para un socio de Centro llegaba convertido en ingreso de Oeste, **sin
 * error y sin rastro**.
 *
 * Estas pruebas fijan la diferencia entre **rechazar** y **reescribir**. Un
 * rechazo se ve en la cuarentena y alguien lo mira; una reescritura no la ve
 * nadie nunca, porque el total sigue cuadrando —solo que en la sede
 * equivocada—.
 */
const OESTE = "gym-oeste";
const CENTRO = "gym-centro";

function repositorio() {
  const guardados: any[] = [];
  const repo: any = {
    withTransaction: () => repo,
    upsertPagoCliente: async (fila: any) => {
      guardados.push(fila);
    },
    softDelete: async () => {},
  };
  return { repo, guardados };
}

const payload = (extra: Record<string, unknown> = {}) => ({
  ci: "99090100009",
  fecha: "2026-08-17T12:00:00.000Z",
  monto_total: "300.00",
  id_planes_pago: "plan-1",
  moneda_id: "moneda-cup",
  version: 1,
  ...extra,
});

const aplicar = async (
  base: ReturnType<typeof repositorio>,
  extra: Record<string, unknown> = {},
  autorizado = false,
) =>
  new ApplyPagoClienteEventUseCase(base.repo).execute({
    eventId: "ev-1",
    entidadId: "pago-1",
    operacion: "INSERT",
    gymId: OESTE,
    deviceId: "device-oeste",
    payload: payload(extra) as any,
    resolverSocioAutorizado: async () => autorizado,
  });

describe("M4c · a quién se atribuye el ingreso de un cobro que sube", () => {
  it("el cobro corriente sigue siendo de quien lo sube, y sin caja ajena", async () => {
    const base = repositorio();
    await aplicar(base, { gym_id: OESTE });

    expect(base.guardados[0].gym_id).toBe(OESTE);
    // Nulo, no `OESTE`: guardar la coincidencia borraría la diferencia entre
    // «no aplica» y «cobrado aquí para otro».
    expect(base.guardados[0].cobrado_en_gym_id).toBeNull();
  });

  it("un payload sin sede se atribuye al dispositivo, por compatibilidad", async () => {
    const base = repositorio();
    await aplicar(base, {});
    expect(base.guardados[0].gym_id).toBe(OESTE);
  });

  it("el cobro cruzado autorizado conserva la sede DUEÑA del ingreso", async () => {
    // Esta es la prueba que da sentido al corte: el ingreso NO se convierte en
    // el de quien sube.
    const base = repositorio();
    await aplicar(
      base,
      { gym_id: CENTRO, cobrado_en_gym_id: OESTE },
      true,
    );

    expect(base.guardados[0].gym_id).toBe(CENTRO);
    expect(base.guardados[0].cobrado_en_gym_id).toBe(OESTE);
  });

  it("sin socio autorizado se RECHAZA; no se reescribe a la sede que sube", async () => {
    // El agujero exacto que existía: aquí antes se guardaba `gym_id: OESTE` y
    // nadie se enteraba. Ahora no se guarda nada.
    const base = repositorio();
    await expect(
      aplicar(base, { gym_id: CENTRO, cobrado_en_gym_id: OESTE }, false),
    ).rejects.toBeInstanceOf(AtribucionDeCobroError);
    expect(base.guardados).toHaveLength(0);
  });

  it("nadie puede declarar que cobró un tercero", async () => {
    // Declarar que el efectivo entró en otra caja movería una deuda a una sede
    // que no vio el dinero.
    const base = repositorio();
    await expect(
      aplicar(base, { gym_id: CENTRO, cobrado_en_gym_id: CENTRO }, true),
    ).rejects.toBeInstanceOf(AtribucionDeCobroError);
    expect(base.guardados).toHaveLength(0);
  });

  it("no consulta la autorización cuando el cobro es propio", async () => {
    // Una consulta por cobro corriente sería un coste en el camino caliente de
    // la cola, y este es el caso del 99 % de los eventos.
    let consultado = false;
    const base = repositorio();
    await new ApplyPagoClienteEventUseCase(base.repo).execute({
      eventId: "ev-2",
      entidadId: "pago-2",
      operacion: "INSERT",
      gymId: OESTE,
      deviceId: "device-oeste",
      payload: payload({ gym_id: OESTE }) as any,
      resolverSocioAutorizado: async () => {
        consultado = true;
        return true;
      },
    });
    expect(consultado).toBeFalse();
  });

  it("sin resolvedor inyectado, el cobro cruzado se rechaza: falla cerrado", async () => {
    const base = repositorio();
    await expect(
      new ApplyPagoClienteEventUseCase(base.repo).execute({
        eventId: "ev-3",
        entidadId: "pago-3",
        operacion: "INSERT",
        gymId: OESTE,
        deviceId: "device-oeste",
        payload: payload({ gym_id: CENTRO, cobrado_en_gym_id: OESTE }) as any,
      }),
    ).rejects.toBeInstanceOf(AtribucionDeCobroError);
    expect(base.guardados).toHaveLength(0);
  });
});
