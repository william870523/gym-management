import { describe, expect, it, mock } from "bun:test";
import { PrismaClienteRepository } from "./PrismaClienteRepository";

describe("PrismaClienteRepository · runInClient", () => {
  function execute(client: any) {
    const repository = new PrismaClienteRepository(client);
    return (repository as any).runInClient(async (activeClient: any) => {
      activeClient.executed = true;
      return "ok";
    });
  }

  it("abre una transacción con el cliente raíz", async () => {
    const transaction = mock(async (work: (client: any) => Promise<unknown>) =>
      work({ transactionClient: true }),
    );

    await expect(execute({ $transaction: transaction })).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("reutiliza el cliente transaccional del upload", async () => {
    const transactionClient: any = {};

    await expect(execute(transactionClient)).resolves.toBe("ok");
    expect(transactionClient.executed).toBeTrue();
  });
});
