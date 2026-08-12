import { describe, expect, it, mock } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { PrismaMonedaRepository } from "./PrismaMonedaRepository";

/**
 * Barrido de `runInClient`, escrito el 12-08-2026 después de encontrar el
 * tercero.
 *
 * El helper aparece copiado en seis repositorios. Cinco lo tenían bien y
 * `PrismaMonedaRepository` decía:
 *
 *     return typeof this.client.$transaction === "function"
 *       ? this.runInClient(work)          // <- a sí mismo
 *       : work(this.client);
 *
 * Con el prisma raíz —el caso normal— eso es recursión infinita: revienta la
 * pila en la primera llamada. No saltó nunca porque las monedas se siembran
 * directamente y nadie las crea por esa ruta, así que el código estaba muerto y
 * roto a la vez.
 *
 * Ya existía `prisma-cliente-run-in-client.test.ts`, con un caso llamado «abre
 * la transacción raíz sin recursión». Probaba dos repositorios **por su
 * nombre**, y por eso el tercero se escapó. Esta prueba no nombra a ninguno:
 * lee el directorio y los comprueba todos. Cuando alguien copie el helper a un
 * séptimo repositorio, entrará solo en el barrido.
 */
describe("runInClient · ningún repositorio se llama a sí mismo", () => {
  const DIRECTORIO = import.meta.dir;

  const conHelper = readdirSync(DIRECTORIO)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .map((f) => ({ archivo: f, fuente: readFileSync(resolve(DIRECTORIO, f), "utf8") }))
    .filter(({ fuente }) => fuente.includes("private runInClient"));

  it("hay repositorios que copian el helper (si no, esta prueba no comprueba nada)", () => {
    // Sin esta guarda, borrar el helper de todas partes dejaría el barrido
    // vacío y verde. Un barrido sobre cero elementos no es un aprobado.
    expect(conHelper.length).toBeGreaterThanOrEqual(6);
  });

  for (const { archivo, fuente } of conHelper) {
    it(`${archivo} delega en $transaction, no en sí mismo`, () => {
      const cuerpo = fuente.slice(fuente.indexOf("private runInClient"));
      const hastaElCierre = cuerpo.slice(0, cuerpo.indexOf("\n  }"));

      expect({ archivo, recursivo: hastaElCierre.includes("this.runInClient(work)") })
        .toEqual({ archivo, recursivo: false });
      expect(hastaElCierre).toContain("this.client.$transaction(work)");
    });
  }
});

describe("PrismaMonedaRepository · runInClient", () => {
  it("abre la transacción raíz sin recursión", async () => {
    const transaction = mock(async (work: (client: any) => Promise<unknown>) =>
      work({ transactionClient: true }),
    );
    const repository = new PrismaMonedaRepository({ $transaction: transaction });

    await expect(
      (repository as any).runInClient(async (client: any) => client.transactionClient),
    ).resolves.toBeTrue();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("reutiliza el cliente transaccional del upload en vez de anidar", async () => {
    // Un TransactionClient no expone `$transaction`; si el helper intentara
    // abrir otra, Prisma reventaría.
    const transactionClient: any = { deLaSubida: true };
    const repository = new PrismaMonedaRepository(transactionClient);

    await expect(
      (repository as any).runInClient(async (client: any) => client.deLaSubida),
    ).resolves.toBeTrue();
  });
});

/**
 * El repositorio de moneda emitía además su propio evento de `sync_log` dentro
 * de create/update/softDelete, **y el caso de uso emitía otro**. Dos eventos por
 * operación, y encima con nombres distintos: `monedas` el del repositorio,
 * `moneda` el del caso de uso.
 *
 * El receptor local acabó aceptando los dos nombres para no romperse, que es
 * tapar el síntoma en el lado que no tiene la culpa. Ninguna otra de las once
 * entidades emite desde el repositorio: el evento es del caso de uso.
 */
describe("PrismaMonedaRepository · ya no emite eventos por su cuenta", () => {
  const fuente = readFileSync(
    resolve(import.meta.dir, "./PrismaMonedaRepository.ts"),
    "utf8",
  );

  it("no escribe en sync_log", () => {
    expect(fuente).not.toContain("syncLog.create");
  });

  it("no queda rastro del nombre en plural, que nadie más usa", () => {
    expect(fuente).not.toContain('"monedas"');
  });
});
