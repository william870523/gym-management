import { describe, expect, it } from "bun:test";
import { PrismaPagoClienteRepository } from "../../repositories/PrismaPagoClienteRepository";

describe("Libro remoto de pagos", () => {
  it("pagina dentro del gimnasio e incluye pagos anulados", async () => {
    const calls: any[] = [];
    const deleted = {
      pago_cliente_id: "payment-voided",
      ci: "123",
      is_deleted: true,
      cliente: { nombres: "Ana", apellidos: "Demo" },
      detalles: [],
    };
    const repository = new PrismaPagoClienteRepository({
      pagoCliente: {
        async findMany(args: unknown) {
          calls.push(args);
          return [deleted];
        },
      },
      pagoReversion: {
        async findMany() {
          return [{
            pago_cliente_id: "payment-voided",
            registrada_por_user_id: "carla",
            registrada_por_nombre_snapshot: "Carla Supervisión",
            motivo: "Duplicado",
            registrada_at: new Date("2026-08-08T06:00:00Z"),
          }];
        },
      },
    });

    const rows = await repository.findAll("gym-auth", 20, 10);

    expect(calls).toHaveLength(1);
    expect(calls[0].where).toEqual({ gym_id: "gym-auth" });
    expect(calls[0].where).not.toHaveProperty("is_deleted");
    expect(calls[0].skip).toBe(20);
    expect(calls[0].take).toBe(10);
    expect(rows[0]).toMatchObject({
      pago_cliente_id: "payment-voided",
      is_deleted: true,
      clientName: "Ana Demo",
      anulado_por_user_id: "carla",
      anulado_por_nombre_snapshot: "Carla Supervisión",
      motivo_anulacion: "Duplicado",
    });
  });
});
