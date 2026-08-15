import { describe, expect, it, mock } from "bun:test";

import { usuarioSedeId } from "../../auth/usuario-sede";
import { UploadEventsUseCase } from "./UploadEventsUseCase";

const event = (gymId: string, overrides: Record<string, unknown> = {}) => {
  const userId = "m2-user-sync";
  const id = usuarioSedeId(userId, gymId);
  return {
    event_id: "m2-event-sync",
    entidad: "usuario_sede",
    operacion: "INSERT",
    entidad_id: id,
    payload: {
      usuario_sede_id: id,
      user_id: userId,
      gym_id: "gym-inyectado",
      rol: "recepcionista",
      activo: true,
      ...overrides,
    },
  } as any;
};

describe("upload autenticado de usuario_sede", () => {
  it("deriva sede/dispositivo, canoniza rol y exige el usuario padre", async () => {
    const create = mock(async () => undefined);
    const gymId = "gym-auth-m2";
    const tx = {
      usuarioSede: {
        findUnique: mock(async () => null),
        create,
      },
      user: {
        findFirst: mock(async () => ({ user_id: "m2-user-sync" })),
      },
    };
    const useCase = Object.create(UploadEventsUseCase.prototype) as any;

    await useCase.applyPrismaMappedEvent(
      event(gymId),
      gymId,
      "device-auth-m2",
      tx,
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        usuario_sede_id: usuarioSedeId("m2-user-sync", gymId),
        user_id: "m2-user-sync",
        gym_id: gymId,
        source_device: "device-auth-m2",
        rol: "reception",
      }),
    });
  });

  it("falla cerrado si la PK no sale de usuario+sede autenticada", async () => {
    const gymId = "gym-auth-m2";
    const tx = {
      usuarioSede: {
        findUnique: mock(async () => null),
        create: mock(async () => undefined),
      },
      user: {
        findFirst: mock(async () => ({ user_id: "m2-user-sync" })),
      },
    };
    const useCase = Object.create(UploadEventsUseCase.prototype) as any;
    const forged = event(gymId);
    forged.entidad_id = "us-pk-forjada";
    forged.payload.usuario_sede_id = "us-pk-forjada";

    await expect(useCase.applyPrismaMappedEvent(
      forged,
      gymId,
      "device-auth-m2",
      tx,
    )).rejects.toThrow("identidad determinista");
  });
});
