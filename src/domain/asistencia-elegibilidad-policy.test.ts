import { describe, expect, test } from "bun:test";
import {
  decidirEntrada,
  MOTIVO_CUOTA_VENCIDA,
  MOTIVO_PAUSADA,
  MOTIVO_PENDIENTE_PAGO,
} from "./asistencia-elegibilidad-policy";

/**
 * La regla de quién puede marcar entrada estaba suelta dentro del servicio del
 * escritorio, y el remoto tenía media: comprobaba pausa y pago pendiente —con
 * otra redacción— pero no la cuota vencida ni la entrada repetida. Desde el
 * navegador se podía registrar la entrada de un socio moroso y registrarla dos
 * veces.
 *
 * Este fichero es **gemelo exacto** del de la otra API. Si alguien cambia la
 * regla en un lado y no en el otro, las dos superficies vuelven a divergir, que
 * es lo que esto existe para impedir.
 */
describe("decidirEntrada · quién puede marcar entrada", () => {
  const activa = { estado: "ACTIVA", bloqueoPorCuota: null };

  test("quien ya está dentro no entra dos veces: devuelve la misma visita", () => {
    expect(
      decidirEntrada({ tieneEntradaAbierta: true, membresias: [activa] }),
    ).toEqual({ resultado: "YA_DENTRO" });
  });

  test("la entrada repetida manda sobre cualquier bloqueo: ya está dentro", () => {
    // Si se le negara la salida por una mora sobrevenida se quedaría atrapado
    // en un estado sin cerrar. Primero se reconoce el hecho, luego se juzga.
    expect(
      decidirEntrada({
        tieneEntradaAbierta: true,
        membresias: [{ estado: "PAUSADA", bloqueoPorCuota: null }],
      }),
    ).toEqual({ resultado: "YA_DENTRO" });
  });

  test("con membresía activa y sin cuotas, entra", () => {
    expect(
      decidirEntrada({ tieneEntradaAbierta: false, membresias: [activa] }),
    ).toEqual({ resultado: "PERMITIDA" });
  });

  test("el socio antiguo sin contrato histórico sigue entrando", () => {
    // Compatibilidad deliberada: cerrar la regla del todo dejaría fuera a medio
    // padrón, que se dio de alta antes de que existiera el contrato.
    expect(
      decidirEntrada({ tieneEntradaAbierta: false, membresias: [] }),
    ).toEqual({ resultado: "PERMITIDA" });
  });

  test("membresía pausada: 409 con su motivo", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [{ estado: "PAUSADA", bloqueoPorCuota: null }],
      }),
    ).toEqual({ resultado: "BLOQUEADA", status: 409, motivo: MOTIVO_PAUSADA });
  });

  test("membresía pendiente de pago: 409 con su motivo", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [{ estado: "PENDIENTE_PAGO", bloqueoPorCuota: null }],
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_PENDIENTE_PAGO,
    });
  });

  test("la pausa se comprueba antes que el pago pendiente", () => {
    // El orden no es cosmético: con las dos a la vez, el mensaje tiene que ser
    // el mismo en las dos superficies o el operador lee cosas distintas según
    // dónde esté sentado.
    const decision = decidirEntrada({
      tieneEntradaAbierta: false,
      membresias: [
        { estado: "PENDIENTE_PAGO", bloqueoPorCuota: null },
        { estado: "PAUSADA", bloqueoPorCuota: null },
      ],
    });
    expect(decision).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_PAUSADA,
    });
  });

  test("una activa manda sobre una pausada del mismo socio", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [{ estado: "PAUSADA", bloqueoPorCuota: null }, activa],
      }),
    ).toEqual({ resultado: "PERMITIDA" });
  });

  test("activa con cuota vencida: 409 con el motivo que da la política de mora", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [
          {
            estado: "ACTIVA",
            bloqueoPorCuota: { bloqueada: true, motivo: "Cuota 2 vencida el 2026-07-01." },
          },
        ],
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: "Cuota 2 vencida el 2026-07-01.",
    });
  });

  test("si la mora bloquea sin explicar, se dice algo antes que nada", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [
          { estado: "ACTIVA", bloqueoPorCuota: { bloqueada: true, motivo: null } },
        ],
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_CUOTA_VENCIDA,
    });
  });

  test("una activa al día no salva a otra activa morosa", () => {
    // Dos contratos vivos y uno moroso: no se entra a cuenta del que está al
    // día. La deuda es del socio, no del contrato.
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [
          activa,
          { estado: "ACTIVA", bloqueoPorCuota: { bloqueada: true, motivo: "Cuota 1 vencida." } },
        ],
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: "Cuota 1 vencida.",
    });
  });

  test("la cuota al día no bloquea", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [
          { estado: "ACTIVA", bloqueoPorCuota: { bloqueada: false, motivo: null } },
        ],
      }),
    ).toEqual({ resultado: "PERMITIDA" });
  });
});
