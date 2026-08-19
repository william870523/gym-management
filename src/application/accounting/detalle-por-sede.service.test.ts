import { describe, expect, it } from "bun:test";
import { filasDesdeSnapshot } from "./detalle-por-sede.service";
import { totalesDelDetalle, detalleDeLaSede } from "../../domain/detalle-por-sede-policy";

/**
 * M6 — leer el detalle de un cierre firmado sin perder dinero por el camino.
 *
 * El defecto que fija esta prueba salió caminando: el detalle tomaba **el primer
 * detalle** de cada pago, y un cobro partido en dos métodos —10 y 20 en la misma
 * moneda— dejaba el listado veinte por debajo del consolidado que se había ido a
 * auditar. Un detalle que no cuadra con su total no sirve para nada: quien lo
 * abre lo abre justo para explicar una diferencia.
 */
const pago = (extra: Record<string, unknown> = {}) => ({
  pago_cliente_id: "pago-1",
  ocurrido_at_utc: "2026-08-02T10:00:00.000Z",
  ci: "99090100009",
  plan_codigo: "MEN",
  cobrador: { nombre: "Carla" },
  reverso: null,
  detalles: [
    { moneda_id: "cup", direccion: "ENTRADA", monto: "30.00", origen_tipo: "PAGO_CLIENTE" },
  ],
  ...extra,
});

describe("M6 · filas desde el cierre firmado", () => {
  it("suma todos los detalles de la misma moneda, no solo el primero", () => {
    const { cobros } = filasDesdeSnapshot(
      [
        pago({
          detalles: [
            { moneda_id: "cup", direccion: "ENTRADA", monto: "10.00", origen_tipo: "PAGO_CLIENTE" },
            { moneda_id: "cup", direccion: "ENTRADA", monto: "20.00", origen_tipo: "PAGO_CLIENTE" },
          ],
        }),
      ],
      "gym-oeste",
    );
    expect(cobros).toHaveLength(1);
    expect(cobros[0].montoMenor).toBe(3_000);
  });

  it("un pago en dos monedas produce una fila por moneda", () => {
    // Sin esto, la moneda que no fuera la primera desaparecía del detalle.
    const { cobros } = filasDesdeSnapshot(
      [
        pago({
          detalles: [
            { moneda_id: "cup", direccion: "ENTRADA", monto: "30.00", origen_tipo: "PAGO_CLIENTE" },
            { moneda_id: "usd", direccion: "ENTRADA", monto: "5.00", origen_tipo: "PAGO_CLIENTE" },
          ],
        }),
      ],
      "gym-oeste",
    );
    expect(cobros.map((c) => [c.monedaId, c.montoMenor])).toEqual([
      ["cup", 3_000],
      ["usd", 500],
    ]);
  });

  it("el cambio entregado resta del cobro, como en el cierre", () => {
    const { cobros } = filasDesdeSnapshot(
      [
        pago({
          detalles: [
            { moneda_id: "cup", direccion: "ENTRADA", monto: "50.00", origen_tipo: "PAGO_CLIENTE" },
            { moneda_id: "cup", direccion: "SALIDA", monto: "5.00", origen_tipo: "PAGO_CAMBIO" },
          ],
        }),
      ],
      "gym-oeste",
    );
    expect(cobros[0].montoMenor).toBe(4_500);
  });

  it("la reversión no resta: el pago anulado ya no suma", () => {
    // Restarla además lo contaría dos veces y el detalle quedaría por debajo.
    const { cobros, publicados } = filasDesdeSnapshot(
      [
        pago({
          reverso: { reversion_id: "rev-1" },
          detalles: [
            { moneda_id: "cup", direccion: "ENTRADA", monto: "125.00", origen_tipo: "PAGO_CLIENTE" },
            { moneda_id: "cup", direccion: "SALIDA", monto: "125.00", origen_tipo: "PAGO_REVERSION" },
          ],
        }),
      ],
      "gym-oeste",
    );
    expect(cobros[0].montoMenor).toBe(12_500);
    expect(cobros[0].anulado).toBeTrue();
    expect(publicados[0].anulado).toBeTrue();
    // Y en los totales no suma, pero se cuenta.
    const totales = totalesDelDetalle(detalleDeLaSede(cobros, "gym-oeste"));
    expect(totales[0].ingresoMenor).toBe(0);
    expect(totales[0].anulados).toBe(1);
  });

  it("el total del detalle cuadra con el cobro neto del cierre", () => {
    // La comprobación que importa: 8138.70 de entradas menos 280.00 de tres
    // pagos anulados dan los 7858.70 que publica el consolidado. Es el caso real
    // del período 2026-08-01 → 08-05 de Gym Test, reducido.
    const { cobros } = filasDesdeSnapshot(
      [
        pago({
          pago_cliente_id: "partido",
          detalles: [
            { moneda_id: "cup", direccion: "ENTRADA", monto: "10.00", origen_tipo: "PAGO_CLIENTE" },
            { moneda_id: "cup", direccion: "ENTRADA", monto: "20.00", origen_tipo: "PAGO_CLIENTE" },
          ],
        }),
        pago({ pago_cliente_id: "normal", detalles: [
          { moneda_id: "cup", direccion: "ENTRADA", monto: "100.00", origen_tipo: "PAGO_CLIENTE" },
        ] }),
        pago({
          pago_cliente_id: "anulado",
          reverso: { reversion_id: "rev-9" },
          detalles: [
            { moneda_id: "cup", direccion: "ENTRADA", monto: "125.00", origen_tipo: "PAGO_CLIENTE" },
            { moneda_id: "cup", direccion: "SALIDA", monto: "125.00", origen_tipo: "PAGO_REVERSION" },
          ],
        }),
      ],
      "gym-oeste",
    );
    const [total] = totalesDelDetalle(detalleDeLaSede(cobros, "gym-oeste"));
    // 30 + 100 = 130; el anulado no suma.
    expect(total.ingresoMenor).toBe(13_000);
    expect(total.cobros).toBe(3);
    expect(total.anulados).toBe(1);
  });

  it("un pago sin detalles no produce filas fantasma", () => {
    const { cobros } = filasDesdeSnapshot([pago({ detalles: [] })], "gym-oeste");
    expect(cobros).toEqual([]);
  });
});
