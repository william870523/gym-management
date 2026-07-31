import { describe, expect, it } from "bun:test";
import { PrismaClienteRepository } from "./PrismaClienteRepository";

/**
 * Regresión del 31-07-2026.
 *
 * El evento de cliente traía `fecha_nacimiento` (E0, §7-bis) y `categoria`
 * (R5.3), el handler los mapeaba… y el upsert no los escribía. El resultado
 * fue una divergencia silenciosa: 104 socios sin fecha y 23 socios VIEJO
 * convertidos en NUEVO en la web, con el escritorio en lo cierto. Ninguna
 * prueba lo veía y la huella de bases tampoco, porque compara claves, no
 * contenido.
 */
describe("PrismaClienteRepository · campos que viajan en la sincronización", () => {
  function clienteDeEvento() {
    return {
      ci: "91102110037",
      tipo_documento: "CI_CUBANO",
      fecha_nacimiento: new Date("1991-10-21T00:00:00.000Z"),
      categoria: "VIEJO",
      nombres: "Ana",
      apellidos: "Pérez",
      sexo: "Femenino",
      foto_cliente: null,
      cliente_peso_id: "peso-1",
      estatura_cliente: 165,
      direccion: null,
      telefono: null,
      nacionalidad_id: "nac-1",
      correo: null,
      objetivo: null,
      id_planes_pago: null,
      id_entrenador: null,
      fecha_inicio: new Date("2026-01-01T00:00:00.000Z"),
      fecha_fin: new Date("2026-02-01T00:00:00.000Z"),
      activo: true,
      id_horarios: null,
      referencia_id: null,
      gym_id: "gym-1",
      source_device: "device-1",
      version: 3,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    } as any;
  }

  function clienteFalso(existente: { gym_id: string } | null) {
    const escrituras: Array<{ operacion: string; data: any }> = [];
    const delegate = {
      findUnique: async () => existente,
      create: async ({ data }: any) => {
        escrituras.push({ operacion: "create", data });
      },
      updateMany: async ({ data }: any) => {
        escrituras.push({ operacion: "updateMany", data });
        return { count: 1 };
      },
    };
    return { escrituras, client: { cliente: delegate } as any };
  }

  it("escribe fecha de nacimiento y categoría al crear", async () => {
    const { escrituras, client } = clienteFalso(null);
    await new PrismaClienteRepository(client).upsertFromSync(clienteDeEvento());

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]?.operacion).toBe("create");
    expect(escrituras[0]?.data.fecha_nacimiento).toEqual(
      new Date("1991-10-21T00:00:00.000Z"),
    );
    expect(escrituras[0]?.data.categoria).toBe("VIEJO");
  });

  it("escribe fecha de nacimiento y categoría al actualizar", async () => {
    const { escrituras, client } = clienteFalso({ gym_id: "gym-1" });
    await new PrismaClienteRepository(client).upsertFromSync(clienteDeEvento());

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]?.operacion).toBe("updateMany");
    expect(escrituras[0]?.data.fecha_nacimiento).toEqual(
      new Date("1991-10-21T00:00:00.000Z"),
    );
    expect(escrituras[0]?.data.categoria).toBe("VIEJO");
  });

  it("no escribe la cadena \"null\" cuando el socio no tiene ficha de peso", async () => {
    const evento = clienteDeEvento();
    evento.cliente_peso_id = null;
    const { escrituras, client } = clienteFalso(null);
    await new PrismaClienteRepository(client).upsertFromSync(evento);

    expect(escrituras[0]?.data.cliente_peso_id).toBeNull();
    expect(escrituras[0]?.data.cliente_peso_id).not.toBe("null");
  });

  it("no inventa categoría cuando el evento es anterior a R5.3", async () => {
    const evento = clienteDeEvento();
    evento.fecha_nacimiento = null;
    evento.categoria = undefined;
    const { escrituras, client } = clienteFalso(null);
    await new PrismaClienteRepository(client).upsertFromSync(evento);

    expect(escrituras[0]?.data.fecha_nacimiento).toBeNull();
    expect(escrituras[0]?.data.categoria).toBe("NUEVO");
  });
});
