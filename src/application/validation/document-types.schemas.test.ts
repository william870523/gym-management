import { describe, expect, it } from "bun:test";
import { ClienteSchema } from "./clients.schemas";
import { EntrenadorSchema } from "./trainers.schemas";

const clienteBase = {
  ci: "02AB001",
  nombres: "Demo",
  apellidos: "Pasaporte",
  sexo: "Otro",
  cliente_peso_id: "peso-1",
  estatura_cliente: 1.7,
  nacionalidad_id: "nacionalidad-1",
  fecha_inicio: "2026-07-25T12:00:00.000Z",
  fecha_fin: "2026-08-25T12:00:00.000Z",
  activo: false,
  id_horarios: "horario-1",
};

const entrenadorBase = {
  ci_entrenador: "02AB001",
  nombres_entrenador: "Demo",
  apellidos_entrenador: "Pasaporte",
  sexo_entrenador: "Otro",
  activo_entrenador: false,
  fecha_incio_entrenador: "2026-07-25T12:00:00.000Z",
};

describe("contrato de tipos documentales", () => {
  it("preserva PASAPORTE como texto en cliente y entrenador", () => {
    expect(
      ClienteSchema.parse({
        ...clienteBase,
        tipo_documento: "PASAPORTE",
      }).tipo_documento,
    ).toBe("PASAPORTE");
    expect(
      EntrenadorSchema.parse({
        ...entrenadorBase,
        tipo_documento: "PASAPORTE",
      }).tipo_documento,
    ).toBe("PASAPORTE");
  });

  it("usa DESCONOCIDO para legado y rechaza códigos libres", () => {
    expect(ClienteSchema.parse(clienteBase).tipo_documento).toBe("DESCONOCIDO");
    expect(EntrenadorSchema.parse(entrenadorBase).tipo_documento).toBe(
      "DESCONOCIDO",
    );
    expect(() =>
      ClienteSchema.parse({
        ...clienteBase,
        tipo_documento: "CEDULA_LIBRE",
      }),
    ).toThrow();
  });
});
