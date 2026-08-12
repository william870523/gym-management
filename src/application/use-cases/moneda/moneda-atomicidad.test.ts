import { describe, expect, it } from "bun:test";
import { CreateMonedaUseCase } from "./CreateMonedaUseCase";
import { UpdateMonedaUseCase } from "./UpdateMonedaUseCase";
import { DeleteMonedaUseCase } from "./DeleteMonedaUseCase";

/**
 * La fila y su evento, en la misma transacción (hoja de ruta R5-P: «hacer
 * atómico el upload entidad+`sync_log`, endurecer también los handlers
 * dedicados»).
 *
 * Los casos de uso de moneda hacían dos `await` sueltos: primero escribían la
 * fila y después registraban el evento. Un fallo entre ambos —el proceso que
 * muere, la conexión que se cae— dejaba la moneda creada en MariaDB **sin
 * evento que la anunciara**. El escritorio no se entera nunca y las dos bases
 * quedan distintas para siempre, sin nada que lo delate: la fila existe, así que
 * ninguna comprobación de integridad la señala, y el evento no existe, así que
 * la cola no tiene nada que reintentar.
 *
 * Es la misma familia que el crédito huérfano del 12-08, con los papeles
 * cambiados: allí llegó el hijo sin el padre, aquí se queda el dato sin su
 * rastro.
 *
 * **Cómo NO probar esto.** El primer intento sustituyó el módulo de Prisma con
 * `mock.module`. Funcionó en su fichero y tiró siete pruebas ajenas: el mock de
 * módulo es global a toda la ejecución. El propio `sync-transaction.ts` ya
 * advertía el camino bueno —«no se usa un singleton implícito… la propagación
 * explícita es la que hace verificable el rollback»—, así que el ejecutor de
 * transacción se inyecta y aquí se pasa un doble.
 */

function montar(opciones: { fallarAlRegistrar?: boolean } = {}) {
  const visto = {
    transacciones: 0,
    txDelRepo: undefined as any,
    txDelRegistro: undefined as any,
    eventos: [] as any[],
    escrituras: [] as string[],
  };

  const enTransaccion = async (fn: (tx: any) => Promise<unknown>) => {
    visto.transacciones += 1;
    return fn({ soyLaTransaccion: true }) as any;
  };

  const repo: any = {
    withTransaction(tx: any) {
      visto.txDelRepo = tx;
      return repo;
    },
    async create() {
      visto.escrituras.push("create");
    },
    async update() {
      visto.escrituras.push("update");
    },
    async softDelete() {
      visto.escrituras.push("softDelete");
    },
    async findById() {
      return {
        moneda_id: "m-1",
        moneda_nombre: "Peso",
        codigo: "CUP",
        simbolo: "₽",
        imagen: null,
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        is_deleted: false,
      };
    },
  };

  const syncLog: any = {
    async register(evento: any, tx: any) {
      if (opciones.fallarAlRegistrar) throw new Error("sync_log caído");
      visto.txDelRegistro = tx;
      visto.eventos.push(evento);
    },
  };

  return { repo, syncLog, enTransaccion, visto };
}

const alta = { moneda_nombre: "Peso", codigo: "CUP" } as any;

describe("moneda · la fila y su evento van en la misma transacción", () => {
  it("el alta abre una transacción y la comparte con el registro", async () => {
    const { repo, syncLog, enTransaccion, visto } = montar();

    await new CreateMonedaUseCase(repo, syncLog, enTransaccion).execute(alta);

    expect(visto.transacciones).toBe(1);
    expect(visto.escrituras).toEqual(["create"]);
    expect(visto.txDelRepo).toBe(visto.txDelRegistro);
    expect(visto.txDelRegistro).toEqual({ soyLaTransaccion: true });
  });

  it("la edición también", async () => {
    const { repo, syncLog, enTransaccion, visto } = montar();

    await new UpdateMonedaUseCase(repo, syncLog, enTransaccion).execute("m-1", {
      moneda_nombre: "Peso cubano",
    } as any);

    expect(visto.transacciones).toBe(1);
    expect(visto.txDelRepo).toBe(visto.txDelRegistro);
  });

  it("la baja también, y es la que más duele perder a medias", async () => {
    // Una moneda dada de baja en el remoto y viva en el escritorio se sigue
    // pudiendo cobrar.
    const { repo, syncLog, enTransaccion, visto } = montar();

    await new DeleteMonedaUseCase(repo, syncLog, enTransaccion).execute("m-1");

    expect(visto.transacciones).toBe(1);
    expect(visto.escrituras).toEqual(["softDelete"]);
    expect(visto.txDelRepo).toBe(visto.txDelRegistro);
  });
});

describe("moneda · un evento por operación, no dos", () => {
  it("el alta emite exactamente uno, y con el nombre en singular", async () => {
    // El repositorio emitía otro con `entidad: "monedas"`. El receptor local
    // tuvo que aprender a aceptar los dos nombres para no romperse, que es
    // tapar el síntoma en el lado que no tiene la culpa.
    const { repo, syncLog, enTransaccion, visto } = montar();

    await new CreateMonedaUseCase(repo, syncLog, enTransaccion).execute(alta);

    expect(visto.eventos).toHaveLength(1);
    expect(visto.eventos[0].entidad).toBe("moneda");
    expect(visto.eventos[0].operacion).toBe("INSERT");
  });
});

describe("moneda · si el evento no se puede registrar, el fallo sale", () => {
  it("no se traga el error del registro", async () => {
    // Con la transacción real esto arrastra el rollback. Lo que aquí se fija es
    // que el caso de uso NO capture el fallo: tragárselo dejaría la fila escrita
    // y el evento perdido, que es justo el defecto que se venía a cerrar.
    const { repo, syncLog, enTransaccion } = montar({ fallarAlRegistrar: true });

    await expect(
      new CreateMonedaUseCase(repo, syncLog, enTransaccion).execute(alta),
    ).rejects.toThrow("sync_log caído");
  });
});
