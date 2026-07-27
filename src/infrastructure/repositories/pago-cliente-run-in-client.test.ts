import { describe, expect, it, mock } from "bun:test";
import { PrismaPagoClienteRepository } from "./PrismaPagoClienteRepository";

/**
 * `runInClient` decide si abre transacción propia o reutiliza la del upload.
 *
 * Se llamaba a sí mismo en vez de llamar a `$transaction` del cliente: una
 * recursión infinita en posición de cola, que JavaScriptCore convierte en un
 * bucle. No desbordaba la pila; dejaba el proceso girando al 100 % de CPU y
 * bloqueaba el event loop, así que el servidor entero dejaba de responder ante
 * un solo cobro. Ninguna prueba lo veía porque el camino de sync entra por
 * `withTransaction`, que toma la otra rama.
 *
 * Aviso: si alguien reintroduce la recursión, esta prueba NO fallará con un
 * mensaje: colgará la suite. Un bucle síncrono bloquea el event loop, así que
 * ningún temporizador ni timeout de prueba puede interrumpirlo. Una suite que
 * se queda parada en este archivo apunta exactamente a esa regresión.
 */
describe("PrismaPagoClienteRepository · runInClient", () => {
  /** Ejecuta `runInClient` a través de un método público que lo usa. */
  function runThrough(client: any) {
    const repo = new PrismaPagoClienteRepository(client);
    return (repo as any).runInClient(async (c: any) => {
      c.marca = "trabajo ejecutado";
      return "listo";
    });
  }

  it("con el cliente raíz abre una transacción y termina", async () => {
    const transaction = mock(async (work: (c: any) => Promise<unknown>) =>
      work({ esTransaccion: true }),
    );
    const root = { $transaction: transaction };

    const result = await runThrough(root);

    expect(result).toBe("listo");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("dentro del upload reutiliza la transacción, sin anidar otra", async () => {
    // Un TransactionClient no expone `$transaction`.
    const tx: any = { esTransaccion: true };

    const result = await runThrough(tx);

    expect(result).toBe("listo");
    expect(tx.marca).toBe("trabajo ejecutado");
  });
});
