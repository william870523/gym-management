import { describe, expect, it } from "bun:test";
import {
  DIAS_VENCIMIENTO_RECIENTE,
  resolveMembershipVigencia,
} from "./membership-vigencia";

const HOY = new Date(Date.UTC(2026, 6, 27)); // 27-07-2026, fecha de negocio
const dia = (offset: number) =>
  new Date(HOY.getTime() + offset * 86_400_000);

const vigencia = (estado: string | null, fechaFin: Date | null) =>
  resolveMembershipVigencia({ estado, fechaFin, fechaNegocio: HOY });

describe("vigencia derivada de una membresía", () => {
  it("el último día de cobertura todavía cubre", () => {
    // Si `fecha_fin` es hoy, el socio pagó por hoy: echarlo sería cobrarle un
    // día menos del que contrató.
    expect(vigencia("ACTIVA", HOY)).toMatchObject({
      vigencia: "VIGENTE",
      cubreHoy: true,
      diasDesdeVencimiento: 0,
    });
  });

  it("una ACTIVA con la cobertura terminada NO está vigente", () => {
    // El caso que lo motivó: la ficha daba por vigente a quien venció el 19-07.
    const resultado = vigencia("ACTIVA", dia(-8));
    expect(resultado.vigencia).toBe("VENCIDA_RECIENTE");
    expect(resultado.cubreHoy).toBe(false);
    expect(resultado.diasDesdeVencimiento).toBe(8);
  });

  it("distingue la ventana de cortesía de la caducidad definitiva", () => {
    expect(vigencia("ACTIVA", dia(-DIAS_VENCIMIENTO_RECIENTE)).vigencia)
      .toBe("VENCIDA_RECIENTE");
    expect(vigencia("ACTIVA", dia(-DIAS_VENCIMIENTO_RECIENTE - 1)).vigencia)
      .toBe("VENCIDA");
  });

  it("informa los días que faltan como número negativo", () => {
    // Sirve para el aviso de «por vencer» sin repetir la resta en cada vista.
    expect(vigencia("ACTIVA", dia(3)).diasDesdeVencimiento).toBe(-3);
  });

  it("la baja manda sobre la fecha", () => {
    // Cancelada con cobertura hasta fin de mes: no está vigente.
    expect(vigencia("CANCELADA", dia(30))).toMatchObject({
      vigencia: "CANCELADA",
      cubreHoy: false,
    });
  });

  it("una pausa detiene el reloj: no se compara contra hoy", () => {
    // Su `fecha_fin` se recalcula al reanudar, así que mirarla ahora no dice
    // nada. Pausada tampoco cubre: no se entra al gimnasio congelado.
    expect(vigencia("PAUSADA", dia(-100))).toMatchObject({
      vigencia: "PAUSADA",
      cubreHoy: false,
      diasDesdeVencimiento: null,
    });
  });

  it("contratada y sin pagar no cubre", () => {
    expect(vigencia("PENDIENTE_PAGO", dia(30))).toMatchObject({
      vigencia: "PENDIENTE_PAGO",
      cubreHoy: false,
    });
  });

  it("sin membresía, o con un estado desconocido, falla cerrado", () => {
    // Lo que está en juego es quién entra: ante la duda, no cubre.
    expect(vigencia(null, null).vigencia).toBe("SIN_MEMBRESIA");
    expect(vigencia("", null).vigencia).toBe("SIN_MEMBRESIA");
    expect(vigencia("LO_QUE_SEA", dia(30))).toMatchObject({
      vigencia: "SIN_MEMBRESIA",
      cubreHoy: false,
    });
  });

  it("normaliza el estado sin depender de mayúsculas ni espacios", () => {
    expect(vigencia("  activa  ", dia(5)).vigencia).toBe("VIGENTE");
  });

  it("una VENCIDA persistida se recalcula igual que una ACTIVA", () => {
    // El estado guardado no manda sobre la cobertura: si alguien escribió
    // VENCIDA pero la fecha aún cubre, cubre.
    expect(vigencia("VENCIDA", dia(5)).vigencia).toBe("VIGENTE");
  });

  it("activa sin fecha de fin no se declara vencida por invención", () => {
    expect(vigencia("ACTIVA", null)).toMatchObject({
      vigencia: "VIGENTE",
      diasDesdeVencimiento: null,
    });
  });

  it("acepta la fecha en texto, como llega de la base o del JSON", () => {
    const resultado = resolveMembershipVigencia({
      estado: "ACTIVA",
      fechaFin: "2026-07-19T00:00:00.000Z" as any,
      fechaNegocio: HOY,
    });
    expect(resultado.vigencia).toBe("VENCIDA_RECIENTE");
    expect(resultado.diasDesdeVencimiento).toBe(8);
  });
});
