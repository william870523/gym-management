import { describe, expect, it, mock } from "bun:test";
import { PrismaPagoClienteRepository } from "./PrismaPagoClienteRepository";

/**
 * §7.8 — la baja de un cobro cruzado la sube la sede que devolvió el dinero.
 *
 * El guardián de escritura por sede rechaza toda fila cuya PK «pertenece a otro
 * gimnasio», y hace bien: es lo que impide que una sede reescriba lo ajeno. Pero
 * un cobro cruzado lleva el `gym_id` de la **dueña del ingreso** mientras que
 * quien puede anularlo es la sede donde entró el **efectivo**, así que la baja
 * legítima chocaba con él.
 *
 * Medido el 20-08-2026 anulando desde la instalación: el cobro quedaba anulado
 * en la sede y **vivo en el concentrador** —el reverso a medias que §7.8
 * prohíbe—, y el evento agotaba sus intentos y atascaba la cola. No se había
 * visto porque el recorrido de §7.8 anuló desde el concentrador, donde la fila y
 * quien escribe están en la misma base.
 *
 * Lo que se fija aquí es que la excepción sea **exactamente** la autoridad de
 * §7.8 y no un agujero: quien no puede anular sigue chocando con el guardián.
 */
describe("PrismaPagoClienteRepository · baja de un cobro cruzado", () => {
  const CRUZADO = {
    gym_id: "dtc-gym-ajeno", // dueña del ingreso
    cobrado_en_gym_id: "local-gym-001", // donde entró el efectivo
  };

  function repoCon(fila: Record<string, unknown> | null) {
    const updateMany = mock(async () => ({ count: 1 }));
    const findUnique = mock(async () => fila);
    const client = { pagoCliente: { findUnique, updateMany } };
    return {
      repo: new PrismaPagoClienteRepository(client as never),
      updateMany,
    };
  }

  it("la acepta de la sede que tiene el efectivo", async () => {
    const { repo, updateMany } = repoCon(CRUZADO);

    await repo.softDelete("pago-cruzado", "local-gym-001");

    expect(updateMany).toHaveBeenCalledTimes(1);
    // Se escribe contra la sede DUEÑA de la fila: es la suya, y reasignarla a
    // quien anula convertiría el ingreso en de otro al darlo de baja.
    const donde = (updateMany.mock.calls[0] as any)[0].where;
    expect(donde.gym_id).toBe("dtc-gym-ajeno");
  });

  it("la acepta de la dueña cuando el cobro no es cruzado", async () => {
    // El camino de siempre no cambia: sin efectivo en otra caja, quien anula es
    // la dueña, y la fila es suya.
    const { repo, updateMany } = repoCon({
      gym_id: "local-gym-001",
      cobrado_en_gym_id: null,
    });

    await repo.softDelete("pago-normal", "local-gym-001");

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect((updateMany.mock.calls[0] as any)[0].where.gym_id).toBe("local-gym-001");
  });

  it("de la dueña del ingreso pasa, y quien la para es el 403, no esto", async () => {
    // Conviene no confundir las dos defensas. El guardián solo mira de quién es
    // la fila, y la fila **es** de la dueña del ingreso: por aquí pasa. Quien
    // impide que la dueña anule un cobro cuyo efectivo está en otra caja es
    // `puedeAnularElCobro` en el servicio de reverso, que contesta 403 —medido
    // por HTTP el 20-08-2026 desde una sesión de la sede ajena— y por eso este
    // evento no llega a emitirse nunca.
    //
    // Si algún día se emitiera, esta baja aplicaría; pretender arreglarlo aquí
    // pondría la regla de §7.8 en dos sitios y una de las dos se quedaría atrás.
    const { repo, updateMany } = repoCon(CRUZADO);

    await repo.softDelete("pago-cruzado", "dtc-gym-ajeno");

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("la rechaza de una sede que no pinta nada", async () => {
    const { repo, updateMany } = repoCon(CRUZADO);

    await expect(repo.softDelete("pago-cruzado", "m2-gym-oeste")).rejects.toThrow(
      "pertenece a otro gimnasio",
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("una fila que no existe se da por aplicada", async () => {
    // La baja es idempotente: si el cobro ya no está, no hay nada que hacer y
    // fallar aquí atascaría la cola por un evento que ya cumplió su función.
    const { repo, updateMany } = repoCon(null);

    await repo.softDelete("pago-inexistente", "local-gym-001");

    expect(updateMany).not.toHaveBeenCalled();
  });
});
