import { describe, expect, it } from "bun:test";
import { ApplyAsistenciaEventUseCase } from "./ApplyAsistenciaEventUseCase";
import { ApplyClienteEventUseCase } from "./ApplyClienteEventUseCase";
import { ApplyClientePesoEventUseCase } from "./ApplyClientePesoEventUseCase";
import { ApplyCuentaEventUseCase } from "./ApplyCuentaEventUseCase";
import { ApplyDetallePagoEventUseCase } from "./ApplyDetallePagoEventUseCase";
import { ApplyEntrenadorEventUseCase } from "./ApplyEntrenadorEventUseCase";
import { ApplyGymEventUseCase } from "./ApplyGymEventUseCase";
import { ApplyHorarioEventUseCase } from "./ApplyHorarioEventUseCase";
import { ApplyPagoClienteEventUseCase } from "./ApplyPagoClienteEventUseCase";
import { ApplyPlanesPagoEventUseCase } from "./ApplyPlanesPagoEventUseCase";
import { ApplyUserEventUseCase } from "./ApplyUserEventUseCase";

const scopedCases = [
  {
    entity: "cliente",
    upsert: "upsertFromSync",
    make: (repository: any) => new ApplyClienteEventUseCase(repository),
  },
  {
    entity: "user",
    upsert: "upsertFromSync",
    make: (repository: any) => new ApplyUserEventUseCase(repository),
  },
  {
    entity: "cliente_peso",
    upsert: "upsertClientePeso",
    make: (repository: any) => new ApplyClientePesoEventUseCase(repository),
  },
  {
    entity: "asistencia",
    upsert: "upsertAsistencia",
    make: (repository: any) => new ApplyAsistenciaEventUseCase(repository),
  },
  {
    entity: "pago_cliente",
    upsert: "upsertPagoCliente",
    make: (repository: any) => new ApplyPagoClienteEventUseCase(repository),
  },
  {
    entity: "detalle_pago",
    upsert: "upsertDetallePago",
    make: (repository: any) => new ApplyDetallePagoEventUseCase(repository),
  },
  {
    entity: "horario",
    upsert: "upsertHorario",
    make: (repository: any) => new ApplyHorarioEventUseCase(repository),
  },
  {
    entity: "planes_pago",
    upsert: "upsertPlanesPago",
    make: (repository: any) => new ApplyPlanesPagoEventUseCase(repository),
  },
  {
    entity: "cuenta",
    upsert: "upsertCuenta",
    make: (repository: any) => new ApplyCuentaEventUseCase(repository),
  },
  {
    entity: "entrenador",
    upsert: "upsertEntrenador",
    make: (repository: any) => new ApplyEntrenadorEventUseCase(repository),
  },
] as const;

const authenticatedInput = {
  eventId: "event-1",
  entidadId: "entity-1",
  gymId: "gym-auth",
  deviceId: "device-auth",
  payload: {
    gym_id: "gym-atacante",
    source_device: "device-atacante",
    fecha: "2026-07-21T12:00:00.000Z",
    fecha_inicio: "2026-07-21T12:00:00.000Z",
    fecha_fin: "2026-08-21T12:00:00.000Z",
    fecha_incio_entrenador: "2026-07-21T12:00:00.000Z",
    created_at: "2026-07-21T12:00:00.000Z",
  },
};

describe("identidad autoritativa en handlers dedicados", () => {
  it("propaga el tipo documental y usa DESCONOCIDO para eventos antiguos", async () => {
    for (const testCase of scopedCases.filter(
      (candidate) =>
        candidate.entity === "cliente" || candidate.entity === "entrenador",
    )) {
      const writtenRecords: Record<string, unknown>[] = [];
      const repository: Record<string, unknown> = {
        softDelete: async () => undefined,
        [testCase.upsert]: async (record: Record<string, unknown>) => {
          writtenRecords.push(record);
        },
      };
      const useCase = testCase.make(repository);
      await useCase.execute({
        ...authenticatedInput,
        operacion: "INSERT",
        payload: {
          ...authenticatedInput.payload,
          tipo_documento: "PASAPORTE",
        },
      } as any);
      await useCase.execute({
        ...authenticatedInput,
        operacion: "UPDATE",
      } as any);

      expect(writtenRecords[0].tipo_documento, testCase.entity).toBe(
        "PASAPORTE",
      );
      expect(writtenRecords[1].tipo_documento, testCase.entity).toBe(
        "DESCONOCIDO",
      );
    }
  });

  it("sobrescribe gym_id y source_device del payload en todas las filas scoped", async () => {
    for (const testCase of scopedCases) {
      let written: Record<string, unknown> | null = null;
      const repository: Record<string, unknown> = {
        softDelete: async () => undefined,
        [testCase.upsert]: async (record: Record<string, unknown>) => {
          written = record;
        },
      };
      await testCase.make(repository).execute({
        ...authenticatedInput,
        operacion: "INSERT",
      } as any);
      expect(written, testCase.entity).not.toBeNull();
      expect(written!.gym_id, testCase.entity).toBe("gym-auth");
      expect(written!.source_device, testCase.entity).toBe("device-auth");
    }
  });

  it("propaga gym_id al DELETE de todas las filas scoped", async () => {
    for (const testCase of scopedCases) {
      const deleteCalls: unknown[][] = [];
      const repository: Record<string, unknown> = {
        [testCase.upsert]: async () => undefined,
        softDelete: async (...args: unknown[]) => {
          deleteCalls.push(args);
        },
      };
      await testCase.make(repository).execute({
        ...authenticatedInput,
        operacion: "DELETE",
      } as any);
      expect(deleteCalls[0], testCase.entity).toEqual(["entity-1", "gym-auth"]);
    }
  });

  it("impide que un dispositivo modifique otro gimnasio", async () => {
    // Desde multi-sede M1 un dispositivo SÍ puede dar de alta una sede que no
    // existe —es el Dueño creando una sede desde el escritorio—, pero sigue sin
    // poder tocar una sede ajena que ya existe, que es lo que esta prueba
    // protege. El caso permitido vive en `apply-gym-event.test.ts`.
    let touched = false;
    const useCase = new ApplyGymEventUseCase({
      exists: async () => true,
      upsertGym: async () => {
        touched = true;
      },
      softDelete: async () => {
        touched = true;
      },
    } as any);
    await expect(useCase.execute({
      ...authenticatedInput,
      entidadId: "gym-atacante",
      operacion: "UPDATE",
    } as any)).rejects.toThrow("solo modifica su propia sede");
    expect(touched).toBe(false);
  });

  it("impide que un dispositivo dé de baja el gimnasio de otra sede sin autoridad", async () => {
    // La baja ajena exige autoridad de Dueño, y este canal autentica al
    // dispositivo. El evento dice quién la pidió y el remoto lo comprueba en su
    // propia base; sin actor no se borra nada.
    let touched = false;
    const useCase = new ApplyGymEventUseCase({
      exists: async () => true,
      upsertGym: async () => {
        touched = true;
      },
      softDelete: async () => {
        touched = true;
      },
    } as any);
    await expect(useCase.execute({
      ...authenticatedInput,
      entidadId: "gym-atacante",
      operacion: "DELETE",
    } as any)).rejects.toThrow("no dice quién la pidió");
    expect(touched).toBe(false);
  });
});
