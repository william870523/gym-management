import { describe, expect, it } from "bun:test";
import { UploadEventsUseCase } from "./UploadEventsUseCase";

describe("PD-4 — versión de DELETE en mapper Prisma", () => {
  it("aplica la versión del emisor a pago_membresia_aplicacion", async () => {
    let observedUpdate: any = null;
    const tx = {
      pagoMembresiaAplicacion: {
        async findUnique() {
          return { gym_id: "gym-pd4" };
        },
        async updateMany(input: any) {
          observedUpdate = input;
          return { count: 1 };
        },
      },
    };
    const useCase = Object.create(UploadEventsUseCase.prototype) as any;

    await useCase.applyPrismaMappedEvent(
      {
        event_id: "event-pd4-generic-delete",
        entidad: "pago_membresia_aplicacion",
        operacion: "DELETE",
        entidad_id: "aplicacion-pd4",
        payload: { aplicacion_id: "aplicacion-pd4", version: 2 },
        occurred_at_utc: "2026-08-08T00:00:00.000Z",
      },
      "gym-pd4",
      "device-pd4",
      tx,
    );

    expect(observedUpdate.where).toEqual({
      aplicacion_id: "aplicacion-pd4",
      gym_id: "gym-pd4",
    });
    expect(observedUpdate.data).toMatchObject({
      is_deleted: true,
      version: 2,
    });
  });
});
