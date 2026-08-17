import { describe, expect, test } from "bun:test";
import {
  decidirEntrada,
  decidirEntradaVisitante,
  MOTIVO_COBERTURA_VENCIDA,
  MOTIVO_CUOTA_VENCIDA,
  MOTIVO_VISITANTE_SIN_COPIA,
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

/**
 * M4a — la cobertura manda sobre el estado guardado.
 *
 * El defecto que cierran estas pruebas se comprobó por HTTP el 16-08-2026: el
 * socio `79051931768`, cuya cobertura terminó el 2 de marzo, registró entrada
 * con **201**. La regla miraba `estado` y nadie escribe nunca `VENCIDA`, así
 * que una membresía muerta seguía diciendo `ACTIVA`. En aquella base eran 67
 * socios en esa situación.
 */
describe("decidirEntrada · la cobertura vencida cierra el paso", () => {
  const HOY = new Date("2026-08-16T00:00:00.000Z");

  test("una ACTIVA cuya cobertura terminó ya no deja entrar", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [{ estado: "ACTIVA", fechaFin: "2026-03-02T00:00:00.000Z" }],
        fechaNegocio: HOY,
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_COBERTURA_VENCIDA,
    });
  });

  test("`fecha_fin` es exclusiva: el día que figura ya no cubre", () => {
    // El par distingue las dos ramas: el 17 cubre el día 16, el 16 no.
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [{ estado: "ACTIVA", fechaFin: "2026-08-17T00:00:00.000Z" }],
        fechaNegocio: HOY,
      }),
    ).toEqual({ resultado: "PERMITIDA" });
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [{ estado: "ACTIVA", fechaFin: "2026-08-16T00:00:00.000Z" }],
        fechaNegocio: HOY,
      }).resultado,
    ).toBe("BLOQUEADA");
  });

  test("basta una que cubra: la vencida de al lado no estorba", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [
          { estado: "ACTIVA", fechaFin: "2026-03-02T00:00:00.000Z" },
          { estado: "ACTIVA", fechaFin: "2026-09-30T00:00:00.000Z" },
        ],
        fechaNegocio: HOY,
      }),
    ).toEqual({ resultado: "PERMITIDA" });
  });

  test("la mora solo la opinan las que cubren hoy", () => {
    // La vencida está bloqueada por cuota, pero ya no cubre: dejarla hablar
    // daría un motivo que no explica por qué no puede entrar.
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [
          {
            estado: "ACTIVA",
            fechaFin: "2026-03-02T00:00:00.000Z",
            bloqueoPorCuota: { bloqueada: true, motivo: "Cuota 3 vencida." },
          },
          { estado: "ACTIVA", fechaFin: "2026-09-30T00:00:00.000Z" },
        ],
        fechaNegocio: HOY,
      }),
    ).toEqual({ resultado: "PERMITIDA" });
  });

  test("sin fecha de negocio se comporta como antes: no puede hablar de fechas", () => {
    expect(
      decidirEntrada({
        tieneEntradaAbierta: false,
        membresias: [{ estado: "ACTIVA", fechaFin: "2026-03-02T00:00:00.000Z" }],
      }),
    ).toEqual({ resultado: "PERMITIDA" });
  });
});

describe("decidirEntradaVisitante · el socio de otra sede", () => {
  const HOY = new Date("2026-08-16T00:00:00.000Z");
  const copiaVigente = {
    membresia_estado: "ACTIVA",
    membresia_fecha_fin: "2026-09-30T00:00:00.000Z",
  };

  test("con plus vigente y cobertura viva, entra", () => {
    expect(
      decidirEntradaVisitante({
        tieneEntradaAbierta: false,
        visita: { resultado: "VISITANTE" },
        copia: copiaVigente,
        fechaNegocio: HOY,
      }),
    ).toEqual({ resultado: "PERMITIDA" });
  });

  test("el plus bloqueado manda, y conserva su motivo", () => {
    // Importa que el texto sobreviva: «no lo tiene» y «se le venció» se
    // resuelven de maneras distintas en el mostrador.
    expect(
      decidirEntradaVisitante({
        tieneEntradaAbierta: false,
        visita: {
          resultado: "BLOQUEADA",
          status: 409,
          motivo: "El acceso multi-sede del socio venció.",
        },
        copia: copiaVigente,
        fechaNegocio: HOY,
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: "El acceso multi-sede del socio venció.",
    });
  });

  test("sin copia no se entra: falla cerrado", () => {
    expect(
      decidirEntradaVisitante({
        tieneEntradaAbierta: false,
        visita: { resultado: "VISITANTE" },
        copia: null,
        fechaNegocio: HOY,
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_VISITANTE_SIN_COPIA,
    });
    // Una copia sin membresía conocida es lo mismo que no tenerla: el caso
    // «socio antiguo sin contrato» no aplica a quien no es de la casa.
    expect(
      decidirEntradaVisitante({
        tieneEntradaAbierta: false,
        visita: { resultado: "VISITANTE" },
        copia: { membresia_estado: null, membresia_fecha_fin: null },
        fechaNegocio: HOY,
      }).resultado,
    ).toBe("BLOQUEADA");
  });

  test("el visitante con la cobertura vencida en su sede tampoco entra", () => {
    expect(
      decidirEntradaVisitante({
        tieneEntradaAbierta: false,
        visita: { resultado: "VISITANTE" },
        copia: {
          membresia_estado: "ACTIVA",
          membresia_fecha_fin: "2026-03-02T00:00:00.000Z",
        },
        fechaNegocio: HOY,
      }),
    ).toEqual({
      resultado: "BLOQUEADA",
      status: 409,
      motivo: MOTIVO_COBERTURA_VENCIDA,
    });
  });

  test("una pausa en origen se lee igual que en casa", () => {
    expect(
      decidirEntradaVisitante({
        tieneEntradaAbierta: false,
        visita: { resultado: "VISITANTE" },
        copia: { membresia_estado: "PAUSADA", membresia_fecha_fin: null },
        fechaNegocio: HOY,
      }),
    ).toEqual({ resultado: "BLOQUEADA", status: 409, motivo: MOTIVO_PAUSADA });
  });

  test("quien ya está dentro no entra dos veces, venga de donde venga", () => {
    expect(
      decidirEntradaVisitante({
        tieneEntradaAbierta: true,
        visita: { resultado: "VISITANTE" },
        copia: copiaVigente,
        fechaNegocio: HOY,
      }),
    ).toEqual({ resultado: "YA_DENTRO" });
  });
});
