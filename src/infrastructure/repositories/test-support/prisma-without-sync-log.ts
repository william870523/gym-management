/**
 * Adaptador exclusivo de pruebas de repositorio.
 *
 * Las pruebas de cobro ejercitan transacciones reales contra MariaDB, pero no
 * prueban el canal de descarga. Publicar `sync_log` desde ellas permite que la
 * API local descargue filas efímeras antes de que `afterAll` limpie MariaDB.
 * El resultado era una SQLite contaminada cada vez que se ejecutaba `bun test`.
 *
 * El adaptador conserva todas las escrituras de la transacción y sustituye
 * únicamente `syncLog.create` por un no-op. No se usa en código productivo ni
 * en las pruebas específicas de sincronización.
 */
export function prismaWithoutSyncLog<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return async (
          work: unknown,
          options?: unknown,
        ) => {
          const transaction = Reflect.get(target, property, receiver);
          if (typeof transaction !== "function") {
            throw new Error("El cliente Prisma de prueba no expone $transaction.");
          }
          if (Array.isArray(work)) {
            return transaction.call(target, work, options);
          }
          if (typeof work !== "function") {
            throw new Error("La transacción de prueba debe recibir una función.");
          }
          return transaction.call(
            target,
            (tx: object) => work(prismaWithoutSyncLog(tx)),
            options,
          );
        };
      }

      if (property === "syncLog") {
        const delegate = Reflect.get(target, property, receiver) as unknown;
        if (
          delegate === null
          || (typeof delegate !== "object" && typeof delegate !== "function")
        ) {
          throw new Error("El cliente Prisma de prueba no expone syncLog.");
        }
        return new Proxy(delegate as object, {
          get(syncTarget, syncProperty, syncReceiver) {
            if (syncProperty === "create") {
              return async ({ data }: { data: Record<string, unknown> }) => ({
                id: -1,
                ...data,
              });
            }
            const value = Reflect.get(syncTarget, syncProperty, syncReceiver);
            return typeof value === "function" ? value.bind(syncTarget) : value;
          },
        });
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
