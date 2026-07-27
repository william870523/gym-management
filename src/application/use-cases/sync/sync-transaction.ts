/**
 * Contexto transaccional del upload de sincronización — Unidad 01.
 *
 * Manual: docs/execution/01_R5P_UPLOAD_ATOMICITY.md
 *
 * La unidad transaccional del upload es UN evento: la mutación de la entidad y
 * su fila de `sync_log` se confirman juntas o se revierten juntas. Para
 * lograrlo, el contexto (`tx`) se propaga explícitamente desde
 * `UploadEventsUseCase` hasta el delegado de Prisma que escribe.
 *
 * No se usa un singleton implícito ni almacenamiento por contexto asíncrono:
 * la propagación explícita es la que hace verificable el rollback en los tests.
 */

/**
 * Cliente transaccional de Prisma visto de forma estructural. Se modela como
 * un contenedor de delegados por modelo para no acoplar la aplicación a los
 * tipos generados, que cambian con cada `prisma generate`.
 */
export type SyncTransactionContext = Record<string, any>;

/**
 * Ejecutor de una transacción. En producción es `prisma.$transaction`; en los
 * tests, un doble que descarta el staging cuando el callback lanza.
 */
export type SyncTransactionRunner = <T>(
  fn: (tx: SyncTransactionContext) => Promise<T>,
) => Promise<T>;

/**
 * Repositorio que sabe producir una copia de sí mismo ligada a la transacción
 * del upload. Los repositorios de sincronización lo implementan para que el
 * handler pueda escribir la entidad dentro de la misma transacción que el
 * `sync_log` (Unidad 01, paso 3).
 */
export interface SyncTransactionalRepository<TSelf> {
  withTransaction(tx: SyncTransactionContext): TSelf;
}

/**
 * Devuelve el delegado del modelo ligado a la transacción en curso, o el
 * delegado por defecto cuando se opera fuera de una transacción (por ejemplo,
 * en las escrituras que no vienen de sincronización).
 */
export function delegateFor(
  tx: SyncTransactionContext | undefined | null,
  model: string,
  fallback: any,
): any {
  const scoped = tx?.[model];
  return scoped ?? fallback;
}
