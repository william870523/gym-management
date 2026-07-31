import { describe, expect, it } from "bun:test";
import { PrismaPagoClienteRepository } from "./PrismaPagoClienteRepository";

/**
 * Regresión del 31-07-2026, hermana de `prisma-cliente-sync-fields.test.ts`.
 *
 * El evento de cobro traía el snapshot del descuento (R5.3) y
 * `ApplyPagoClienteEventUseCase` lo mapeaba con cuidado… y `upsertPagoCliente`
 * no lo escribía. Resultado medido: **138 cobros con descuento en el escritorio
 * y 0 en la web**, y el informe de descuentos concedidos vacío en remoto.
 *
 * Lo encontró la huella de contenido, no una prueba: por eso esta prueba existe
 * ahora. Usa un cliente falso para no escribir en la MariaDB de desarrollo.
 */
describe("PrismaPagoClienteRepository · snapshot de descuento en la sincronización", () => {
  function cobroDeEvento() {
    return {
      pago_cliente_id: "0078022b-f85a-4ed7-8ef1-ebdac3c89dae",
      ci: "91102110037",
      fecha: new Date("2026-04-22T18:27:59.015Z"),
      monto_total: 127,
      precio_lista_snapshot: 150,
      descuento_pct_snapshot: "15.00",
      descuento_monto_snapshot: 23,
      id_entrenador: null,
      id_planes_pago: "plan-1",
      moneda_id: "cup-1",
      gym_id: "gym-1",
      source_device: "device-1",
      version: 1,
      created_at: new Date("2026-04-22T18:27:59.015Z"),
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
    const referencia = {
      findUnique: async () => ({ gym_id: "gym-1" }),
      findFirst: async () => ({ id: "existe" }),
    };
    return {
      escrituras,
      client: {
        pagoCliente: delegate,
        cliente: referencia,
        planesPago: referencia,
        entrenador: referencia,
      } as any,
    };
  }

  it("escribe el descuento al crear el cobro", async () => {
    const { escrituras, client } = clienteFalso(null);
    await new PrismaPagoClienteRepository(client)
      .upsertPagoCliente(cobroDeEvento());

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]?.operacion).toBe("create");
    expect(escrituras[0]?.data).toMatchObject({
      precio_lista_snapshot: 150,
      descuento_pct_snapshot: "15.00",
      descuento_monto_snapshot: 23,
      monto_total: 127,
    });
  });

  it("escribe el descuento al actualizar el cobro", async () => {
    const { escrituras, client } = clienteFalso({ gym_id: "gym-1" });
    await new PrismaPagoClienteRepository(client)
      .upsertPagoCliente(cobroDeEvento());

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]?.operacion).toBe("updateMany");
    expect(escrituras[0]?.data).toMatchObject({
      precio_lista_snapshot: 150,
      descuento_pct_snapshot: "15.00",
      descuento_monto_snapshot: 23,
    });
  });

  it("no inventa descuento cuando el cobro no lo tuvo", async () => {
    const cobro = cobroDeEvento();
    cobro.precio_lista_snapshot = null;
    cobro.descuento_pct_snapshot = null;
    cobro.descuento_monto_snapshot = null;
    const { escrituras, client } = clienteFalso(null);
    await new PrismaPagoClienteRepository(client).upsertPagoCliente(cobro);

    expect(escrituras[0]?.data.precio_lista_snapshot).toBeNull();
    expect(escrituras[0]?.data.descuento_pct_snapshot).toBeNull();
    expect(escrituras[0]?.data.descuento_monto_snapshot).toBeNull();
  });
});
