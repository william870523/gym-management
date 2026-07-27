import { describe, expect, it } from "bun:test";
import {
  DIAS_VENCIMIENTO_RECIENTE,
  esMembresiaViva,
  resolveMembershipVigencia,
} from "./membership-vigencia";

const HOY = new Date(Date.UTC(2026, 6, 27)); // 27-07-2026, fecha de negocio
const dia = (offset: number) =>
  new Date(HOY.getTime() + offset * 86_400_000);

const vigencia = (estado: string | null, fechaFin: Date | null) =>
  resolveMembershipVigencia({ estado, fechaFin, fechaNegocio: HOY });

describe("vigencia derivada de una membresía", () => {
  it("`fecha_fin` es EXCLUSIVA: el día que marca ya no cubre", () => {
    // No es una elección de este módulo: `resolveServicePeriod` devuelve
    // `endExclusive` y eso es lo que se guarda, y el servidor decide si hay
    // membresía activa con `fecha_fin > hoy`, estrictamente mayor. Un plan
    // Diario contratado el 27 guarda fin = 28 y cubre solo el 27.
    expect(vigencia("ACTIVA", HOY)).toMatchObject({
      vigencia: "VENCIDA_RECIENTE",
      cubreHoy: false,
      diasDesdeVencimiento: 0,
    });
  });

  it("el día anterior al fin sí cubre, y avisa que queda un día", () => {
    expect(vigencia("ACTIVA", dia(1))).toMatchObject({
      vigencia: "VIGENTE",
      cubreHoy: true,
      diasDesdeVencimiento: -1,
    });
  });

  it("una ACTIVA con la cobertura terminada NO está vigente", () => {
    // El caso que lo motivó: la ficha daba por vigente a quien venció el 19-07.
    const resultado = vigencia("ACTIVA", dia(-8));
    expect(resultado.vigencia).toBe("VENCIDA_RECIENTE");
    expect(resultado.cubreHoy).toBe(false);
    expect(resultado.diasDesdeVencimiento).toBe(8);
  });

  it("no regala un día: el borde de la cortesía se mide desde el fin exclusivo", () => {
    expect(vigencia("ACTIVA", dia(-1)).diasDesdeVencimiento).toBe(1);
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
    expect(vigencia("ACTIVA", dia(3)).cubreHoy).toBe(true);
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

describe("quien cuenta como socio vivo del gimnasio", () => {
  it("cuenta a quien está vigente, venció hace poco, está en pausa o debe", () => {
    // Mismo conjunto que los asociados de un plan: si no coincidieran, el
    // contador de un plan y la baja de una sede se contradirían.
    expect(esMembresiaViva("VIGENTE")).toBe(true);
    expect(esMembresiaViva("VENCIDA_RECIENTE")).toBe(true);
    expect(esMembresiaViva("PAUSADA")).toBe(true);
    expect(esMembresiaViva("PENDIENTE_PAGO")).toBe(true);
  });

  it("no cuenta a quien caducó hace tiempo, se dio de baja o no tiene", () => {
    // Una sede cuyos socios vencieron hace medio año no deja a nadie tirado al
    // cerrarse, y bloquear su baja sería un estorbo sin motivo.
    expect(esMembresiaViva("VENCIDA")).toBe(false);
    expect(esMembresiaViva("CANCELADA")).toBe(false);
    expect(esMembresiaViva("SIN_MEMBRESIA")).toBe(false);
  });
});
