import { describe, expect, it } from "bun:test";
import {
  esMesNatural,
  incidenciasDeLaSede,
  mesDe,
  ultimaNoticia,
} from "./semaforo-cierre.service";

/**
 * M5 — lo que el semáforo tiene que leer bien antes de juzgar nada.
 *
 * La política ya está probada aparte. Aquí se fija lo que la alimenta, que es
 * donde estaban las trampas: el mes natural no se firma donde los demás
 * períodos, y el descuadre no se puede sumar entre monedas.
 */
const dia = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

describe("M5 · dónde vive el cierre del período pedido", () => {
  it("julio entero es mes natural: su cierre está en el mensual", () => {
    // El caso corriente. Si esto fallara, el semáforo diría SIN_CERRAR para
    // siempre a sedes que firmaron en plazo, porque miraría la tabla vacía.
    const julio = { fechaInicio: dia("2026-07-01"), fechaFinExclusiva: dia("2026-08-01") };
    expect(esMesNatural(julio)).toBeTrue();
    expect(mesDe(julio)).toBe("2026-07");
  });

  it("febrero de un año bisiesto también, aunque no tenga 30 días", () => {
    expect(
      esMesNatural({ fechaInicio: dia("2028-02-01"), fechaFinExclusiva: dia("2028-03-01") }),
    ).toBeTrue();
  });

  it("una semana o un mes corrido no son mes natural", () => {
    expect(
      esMesNatural({ fechaInicio: dia("2026-07-06"), fechaFinExclusiva: dia("2026-07-13") }),
    ).toBeFalse();
    // Treinta días desde el día 15: dura lo que un mes y no es ninguno.
    expect(
      esMesNatural({ fechaInicio: dia("2026-07-15"), fechaFinExclusiva: dia("2026-08-14") }),
    ).toBeFalse();
  });
});

describe("M5 · incidencias que impiden dar por buena una sede que cerró", () => {
  const arqueo = (extra: Partial<Parameters<typeof incidenciasDeLaSede>[0]["cierresDiarios"][number]>) => ({
    gymId: "gym-norte",
    cuentaId: "caja-1",
    monedaId: "CUP",
    fechaNegocio: dia("2026-07-03"),
    diferencia: "0.00",
    aprobacionEstado: "NO_REQUERIDA",
    ...extra,
  });
  const movimiento = (extra: Partial<Parameters<typeof incidenciasDeLaSede>[0]["movimientos"][number]>) => ({
    movimientoId: "mov-1",
    gymId: "gym-norte",
    cuentaId: "caja-1" as string | null,
    fechaNegocio: dia("2026-07-03"),
    requiereRevision: false,
    ...extra,
  });

  it("cada moneda lleva su descuadre y ninguna se come a la otra", () => {
    const r = incidenciasDeLaSede({
      cierresDiarios: [
        arqueo({ monedaId: "CUP", diferencia: "3.50" }),
        arqueo({ monedaId: "USD", cuentaId: "caja-2", diferencia: "-3.50" }),
      ],
      movimientos: [],
      conciliaciones: [],
    });
    expect(r.descuadres).toEqual([
      { monedaId: "CUP", menor: 350 },
      { monedaId: "USD", menor: -350 },
    ]);
  });

  it("los arqueos de una misma moneda sí se suman entre ellos", () => {
    const r = incidenciasDeLaSede({
      cierresDiarios: [
        arqueo({ diferencia: "1.00" }),
        arqueo({ fechaNegocio: dia("2026-07-04"), diferencia: "0.25" }),
      ],
      movimientos: [],
      conciliaciones: [],
    });
    expect(r.descuadres).toEqual([{ monedaId: "CUP", menor: 125 }]);
  });

  it("una diferencia aprobada o dentro de tolerancia ya no descuadra", () => {
    // Alguien con autoridad la miró y la firmó. Volver a sacarla aquí haría que
    // la sede no pudiera llegar a verde nunca, por un asunto ya resuelto.
    const r = incidenciasDeLaSede({
      cierresDiarios: [
        arqueo({ diferencia: "-9.00", aprobacionEstado: "APROBADA" }),
        arqueo({ cuentaId: "caja-2", diferencia: "2.00", aprobacionEstado: "DENTRO_TOLERANCIA" }),
      ],
      movimientos: [],
      conciliaciones: [],
    });
    expect(r.descuadres).toEqual([]);
  });

  it("una diferencia pendiente de aprobación sí descuadra", () => {
    const r = incidenciasDeLaSede({
      cierresDiarios: [arqueo({ diferencia: "-9.00", aprobacionEstado: "PENDIENTE" })],
      movimientos: [],
      conciliaciones: [],
    });
    expect(r.descuadres).toEqual([{ monedaId: "CUP", menor: -900 }]);
  });

  it("el movimiento que llegó después del arqueo de su día cuenta como pendiente", () => {
    // El caso realista desde M4b: un cobro por cuenta ajena hecho sin conexión
    // sube al concentrador cuando su sede ya había firmado el período.
    const r = incidenciasDeLaSede({
      cierresDiarios: [arqueo({})],
      movimientos: [
        movimiento({ movimientoId: "mov-arqueado" }),
        movimiento({ movimientoId: "mov-tardio", fechaNegocio: dia("2026-07-09") }),
      ],
      conciliaciones: [],
    });
    expect(r.movimientosPendientes).toBe(1);
  });

  it("conciliarlo lo resuelve, que es para lo que existe la conciliación", () => {
    const r = incidenciasDeLaSede({
      cierresDiarios: [arqueo({})],
      movimientos: [movimiento({ movimientoId: "mov-tardio", fechaNegocio: dia("2026-07-09") })],
      conciliaciones: [{ gymId: "gym-norte", movimientoIds: ["mov-tardio"] }],
    });
    expect(r.movimientosPendientes).toBe(0);
  });

  it("pedir revisión o quedarse sin cuenta también deja el movimiento pendiente", () => {
    const r = incidenciasDeLaSede({
      cierresDiarios: [arqueo({})],
      movimientos: [
        movimiento({ movimientoId: "mov-revision", requiereRevision: true }),
        movimiento({ movimientoId: "mov-sin-cuenta", cuentaId: null }),
      ],
      conciliaciones: [],
    });
    expect(r.movimientosPendientes).toBe(2);
  });

  it("un período limpio no inventa incidencias", () => {
    const r = incidenciasDeLaSede({
      cierresDiarios: [arqueo({})],
      movimientos: [movimiento({})],
      conciliaciones: [],
    });
    expect(r).toEqual({ descuadres: [], movimientosPendientes: 0 });
  });
});

describe("M5 · la última noticia de una sede", () => {
  it("manda la más reciente de todas sus señales", () => {
    const vieja = new Date("2026-08-15T10:00:00.000Z");
    const nueva = new Date("2026-08-17T09:00:00.000Z");
    expect(ultimaNoticia([vieja, null, nueva, undefined])).toEqual(nueva);
  });

  it("sin ninguna señal no se inventa una fecha", () => {
    // Devolver «ahora» aquí sería declarar al habla a una sede que nunca ha
    // hablado, y la política dejaría de poder distinguirla.
    expect(ultimaNoticia([null, undefined])).toBeNull();
  });
});
