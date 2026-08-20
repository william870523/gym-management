import { describe, expect, it } from "bun:test";
import { barrerReplicasCaducadas } from "./acceso-multisede.service";

/**
 * El barrido es la mitad que le faltaba a la réplica: sin él, cada sede
 * acumularía para siempre a todos los que alguna vez pagaron el plus
 * (docs/MULTI_SEDE.md §9-bis).
 *
 * Lo que estas pruebas fijan, y que es lo fácil de romper:
 *
 * - **cada sede vence por su reloj**, no por el día UTC ni por el de quien
 *   barre (`MEMBRESIA_VENCIMIENTO_AUTOMATICO.md`, aviso 1);
 * - **solo se escribe lo que cambia**, o la cola se ahoga (aviso 4);
 * - el barrido **no toca el acceso**: retirar la copia es limpieza de una
 *   proyección; apagar `activo` sería inventarse un acto que nadie hizo.
 */
function baseCon(copias: any[], accesos: any[], sedes: any[], membresias: any[] = []) {
  const actualizadas: any[] = [];
  const tocadoAcceso: string[] = [];
  return {
    tx: {
      clienteVisitante: {
        findMany: async () => copias,
        update: async ({ where, data }: any) => {
          actualizadas.push({ ci: where.ci, ...data });
          return { ci: where.ci, ...data };
        },
      },
      membresiaCliente: {
        findFirst: async ({ where }: any) =>
          membresias.find(
            (m) => m.ci === where.ci && m.gym_id === where.gym_id,
          ) ?? null,
      },
      clienteAccesoMultisede: {
        findMany: async () => accesos,
        update: async ({ where }: any) => {
          tocadoAcceso.push(where.cliente_acceso_multisede_id);
          return {};
        },
      },
      gym: { findMany: async () => sedes },
    },
    actualizadas,
    tocadoAcceso,
  };
}

const AHORA = new Date("2026-08-16T12:00:00.000Z");
/** Doble de reloj de sede: La Habana va un día por detrás de Tokio ese día. */
const fechaPorZona = (timezone: string | null | undefined) =>
  timezone === "Asia/Tokyo"
    ? new Date("2026-08-17T00:00:00.000Z")
    : new Date("2026-08-16T00:00:00.000Z");

describe("barrerReplicasCaducadas", () => {
  it("retira la copia cuyo plus ya no cubre y deja la vigente", async () => {
    const { tx, actualizadas } = baseCon(
      [
        { ci: "vencido", gym_id_origen: "gym-a" },
        { ci: "vigente", gym_id_origen: "gym-a" },
      ],
      [
        { ci: "vencido", activo: true, is_deleted: false, vigente_hasta: "2026-08-01T00:00:00.000Z" },
        { ci: "vigente", activo: true, is_deleted: false, vigente_hasta: "2026-09-01T00:00:00.000Z" },
      ],
      [{ gym_id: "gym-a", timezone: "America/Havana" }],
    );

    const r = await barrerReplicasCaducadas({
      tx,
      fechaNegocioDeSede: fechaPorZona,
      sourceDevice: "BARRIDO",
      nowUtc: AHORA,
    });

    expect(r.revisadas).toBe(2);
    expect(actualizadas.map((a) => a.ci)).toEqual(["vencido"]);
    expect(actualizadas[0].is_deleted).toBe(true);
  });

  it("un socio sin acceso, con el acceso apagado o borrado pierde la copia", async () => {
    const { tx, actualizadas } = baseCon(
      [
        { ci: "sin-acceso", gym_id_origen: "gym-a" },
        { ci: "apagado", gym_id_origen: "gym-a" },
        { ci: "borrado", gym_id_origen: "gym-a" },
      ],
      [
        { ci: "apagado", activo: false, is_deleted: false, vigente_hasta: "2026-12-01T00:00:00.000Z" },
        { ci: "borrado", activo: true, is_deleted: true, vigente_hasta: "2026-12-01T00:00:00.000Z" },
      ],
      [{ gym_id: "gym-a", timezone: "America/Havana" }],
    );

    const r = await barrerReplicasCaducadas({
      tx,
      fechaNegocioDeSede: fechaPorZona,
      sourceDevice: "BARRIDO",
      nowUtc: AHORA,
    });

    expect(r.revisadas).toBe(3);
    expect(actualizadas.map((a) => a.ci).sort()).toEqual([
      "apagado",
      "borrado",
      "sin-acceso",
    ]);
  });

  it("cada sede vence por SU reloj, no por el de quien barre", async () => {
    // Las dos copias tienen el mismo `vigente_hasta`. En La Habana todavía es
    // día 16 y cubre; en Tokio ya es 17 y no. Anclar al día UTC —el error que
    // más veces ha vuelto en este proyecto— retiraría las dos o ninguna.
    const { tx, actualizadas } = baseCon(
      [
        { ci: "habana", gym_id_origen: "gym-habana" },
        { ci: "tokio", gym_id_origen: "gym-tokio" },
      ],
      [
        { ci: "habana", activo: true, is_deleted: false, vigente_hasta: "2026-08-17T00:00:00.000Z" },
        { ci: "tokio", activo: true, is_deleted: false, vigente_hasta: "2026-08-17T00:00:00.000Z" },
      ],
      [
        { gym_id: "gym-habana", timezone: "America/Havana" },
        { gym_id: "gym-tokio", timezone: "Asia/Tokyo" },
      ],
    );

    await barrerReplicasCaducadas({
      tx,
      fechaNegocioDeSede: fechaPorZona,
      sourceDevice: "BARRIDO",
      nowUtc: AHORA,
    });

    expect(actualizadas.map((a) => a.ci)).toEqual(["tokio"]);
  });

  it("no escribe nada cuando no hay nada que retirar, ni toca el acceso", async () => {
    const { tx, actualizadas, tocadoAcceso } = baseCon(
      [{ ci: "vigente", gym_id_origen: "gym-a" }],
      [{ ci: "vigente", activo: true, is_deleted: false, vigente_hasta: "2026-12-01T00:00:00.000Z" }],
      [{ gym_id: "gym-a", timezone: "America/Havana" }],
    );

    const r = await barrerReplicasCaducadas({
      tx,
      fechaNegocioDeSede: fechaPorZona,
      sourceDevice: "BARRIDO",
      nowUtc: AHORA,
    });

    expect(r.retiradas).toHaveLength(0);
    expect(actualizadas).toHaveLength(0);
    // Un barrido que tocara filas sin necesidad generaría miles de eventos
    // diarios y ahogaría la cola.
    expect(tocadoAcceso).toHaveLength(0);
  });

  // ------------------------------------ poner al día lo que se conserva (§5.2)

  const VIGENTE = { ci: "vigente", activo: true, is_deleted: false, vigente_hasta: "2026-09-01T00:00:00.000Z" };
  const SEDE_A = [{ gym_id: "gym-a", timezone: "America/Havana" }];

  const barrerRefrescando = (base: ReturnType<typeof baseCon>) =>
    barrerReplicasCaducadas({
      tx: base.tx,
      fechaNegocioDeSede: fechaPorZona,
      sourceDevice: "BARRIDO",
      nowUtc: AHORA,
      refrescarMembresia: true,
    });

  it("pone al día la copia cuya membresía cambió en la sede del socio", async () => {
    // El caso medido: la copia se proyectó al cobrar el plus y se quedó ahí,
    // mientras el socio renovaba en su sede. Nadie la volvía a tocar.
    const base = baseCon(
      [{
        ci: "vigente",
        gym_id_origen: "gym-a",
        membresia_estado: "ACTIVA",
        membresia_fecha_fin: new Date("2026-09-23T00:00:00.000Z"),
      }],
      [VIGENTE],
      SEDE_A,
      [{
        ci: "vigente",
        gym_id: "gym-a",
        estado: "ACTIVA",
        fecha_fin: new Date("2027-06-20T00:00:00.000Z"),
      }],
    );

    const r = await barrerRefrescando(base);

    expect(r.retiradas).toHaveLength(0);
    expect(r.refrescadas).toHaveLength(1);
    expect(base.actualizadas[0].membresia_fecha_fin).toEqual(
      new Date("2027-06-20T00:00:00.000Z"),
    );
    // Poner al día no es retirar: la copia sigue viva.
    expect(base.actualizadas[0].is_deleted).toBeUndefined();
  });

  it("una baja en origen llega a la copia", async () => {
    // La dirección peligrosa: mientras la copia diga ACTIVA, la sede visitada
    // deja entrar sin conexión a quien ya no tiene derecho.
    const base = baseCon(
      [{
        ci: "vigente",
        gym_id_origen: "gym-a",
        membresia_estado: "ACTIVA",
        membresia_fecha_fin: new Date("2027-06-20T00:00:00.000Z"),
      }],
      [VIGENTE],
      SEDE_A,
      [{
        ci: "vigente",
        gym_id: "gym-a",
        estado: "CANCELADA",
        fecha_fin: new Date("2027-06-20T00:00:00.000Z"),
      }],
    );

    const r = await barrerRefrescando(base);

    expect(r.refrescadas).toHaveLength(1);
    expect(base.actualizadas[0].membresia_estado).toBe("CANCELADA");
  });

  it("si no cambió nada, no escribe: la cola llega a todas las sedes", async () => {
    // Cada fila tocada es un evento que bajan TODAS las instalaciones. Un
    // barrido que reescribiera lo idéntico cada doce horas las ahogaría.
    const base = baseCon(
      [{
        ci: "vigente",
        gym_id_origen: "gym-a",
        membresia_estado: "ACTIVA",
        membresia_fecha_fin: new Date("2027-06-20T00:00:00.000Z"),
      }],
      [VIGENTE],
      SEDE_A,
      [{
        ci: "vigente",
        gym_id: "gym-a",
        estado: "ACTIVA",
        fecha_fin: new Date("2027-06-20T00:00:00.000Z"),
      }],
    );

    const r = await barrerRefrescando(base);

    expect(r.refrescadas).toHaveLength(0);
    expect(base.actualizadas).toHaveLength(0);
  });

  it("sin el permiso explícito no toca la membresía", async () => {
    // Apagado por defecto porque **solo el concentrador** tiene las membresías
    // de todas las sedes. Una instalación que lo encendiera no encontraría la
    // del socio ajeno y le escribiría «sin membresía» a la copia.
    const base = baseCon(
      [{
        ci: "vigente",
        gym_id_origen: "gym-a",
        membresia_estado: "ACTIVA",
        membresia_fecha_fin: new Date("2026-09-23T00:00:00.000Z"),
      }],
      [VIGENTE],
      SEDE_A,
      [],
    );

    const r = await barrerReplicasCaducadas({
      tx: base.tx,
      fechaNegocioDeSede: fechaPorZona,
      sourceDevice: "BARRIDO",
      nowUtc: AHORA,
    });

    expect(r.refrescadas).toHaveLength(0);
    expect(base.actualizadas).toHaveLength(0);
  });

  it("la copia caducada se retira y no se pone al día", async () => {
    // Primero se decide si se conserva. Refrescar una copia que va a irse
    // gastaría un evento en una fila que el siguiente ya no verá.
    const base = baseCon(
      [{
        ci: "vencido",
        gym_id_origen: "gym-a",
        membresia_estado: "ACTIVA",
        membresia_fecha_fin: new Date("2026-09-23T00:00:00.000Z"),
      }],
      [{ ci: "vencido", activo: true, is_deleted: false, vigente_hasta: "2026-08-01T00:00:00.000Z" }],
      SEDE_A,
      [{
        ci: "vencido",
        gym_id: "gym-a",
        estado: "ACTIVA",
        fecha_fin: new Date("2027-06-20T00:00:00.000Z"),
      }],
    );

    const r = await barrerRefrescando(base);

    expect(r.retiradas).toHaveLength(1);
    expect(r.refrescadas).toHaveLength(0);
    expect(base.actualizadas).toHaveLength(1);
    expect(base.actualizadas[0].is_deleted).toBe(true);
  });

  it("sin copias vivas no consulta nada más", async () => {
    let consultoAccesos = false;
    const tx = {
      clienteVisitante: { findMany: async () => [], update: async () => ({}) },
      clienteAccesoMultisede: {
        findMany: async () => {
          consultoAccesos = true;
          return [];
        },
      },
      gym: { findMany: async () => [] },
    };
    const r = await barrerReplicasCaducadas({
      tx,
      fechaNegocioDeSede: fechaPorZona,
      sourceDevice: "BARRIDO",
      nowUtc: AHORA,
    });
    expect(r).toEqual({ revisadas: 0, retiradas: [], refrescadas: [] });
    expect(consultoAccesos).toBe(false);
  });
});
