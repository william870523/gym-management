import { describe, expect, it } from "bun:test";
import { ApplyClienteEventUseCase } from "./ApplyClienteEventUseCase";
import type { Cliente } from "../../../domain/entities/Cliente";

/**
 * Regresión del 31-07-2026: `String(null)` devuelve la cadena `"null"`.
 *
 * El mapeo del evento de cliente hacía `String(payload.cliente_peso_id)` sin
 * comprobar el nulo, así que todo socio sin ficha de peso llegaba a MariaDB con
 * una clave foránea de cuatro letras dentro. No lo vio ninguna prueba: lo vio
 * la huella de contenido, comparando columna por columna contra SQLite.
 */
describe("ApplyClienteEventUseCase · nulos que no deben volverse texto", () => {
  function repositorioEspia() {
    const escritos: Cliente[] = [];
    return {
      escritos,
      repo: {
        withTransaction() {
          return this;
        },
        async upsertFromSync(cliente: Cliente) {
          escritos.push(cliente);
        },
        async softDelete() {},
      } as any,
    };
  }

  const payloadBase = {
    tipo_documento: "CI_CUBANO",
    nombres: "Ana",
    apellidos: "Pérez",
    sexo: "Femenino",
    estatura_cliente: 165,
    nacionalidad_id: "nac-1",
    fecha_inicio: "2026-01-01T00:00:00.000Z",
    fecha_fin: "2026-02-01T00:00:00.000Z",
    activo: true,
    categoria: "VIEJO",
  };

  it("deja `cliente_peso_id` en null cuando el socio no tiene ficha de peso", async () => {
    const { escritos, repo } = repositorioEspia();
    await new ApplyClienteEventUseCase(repo).execute({
      eventId: "evt-1",
      entidadId: "91102110037",
      operacion: "UPDATE",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: { ...payloadBase, cliente_peso_id: null } as any,
    });

    expect(escritos[0]?.cliente_peso_id).toBeNull();
    expect(escritos[0]?.cliente_peso_id).not.toBe("null");
  });

  it("conserva el identificador cuando sí existe", async () => {
    const { escritos, repo } = repositorioEspia();
    await new ApplyClienteEventUseCase(repo).execute({
      eventId: "evt-2",
      entidadId: "91102110037",
      operacion: "UPDATE",
      gymId: "gym-1",
      deviceId: "device-1",
      payload: { ...payloadBase, cliente_peso_id: "peso-7" } as any,
    });

    expect(escritos[0]?.cliente_peso_id).toBe("peso-7");
  });
});
