export interface WaitForDatabaseOptions {
  check: () => Promise<void>;
  timeoutMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, remainingMs: number) => void;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Espera a que MariaDB esté disponible antes de abrir el puerto HTTP.
 *
 * Docker puede tardar varios segundos después de iniciar Windows. Un fallo de
 * conexión durante ese intervalo no significa que la configuración sea
 * inválida; la validación UTC sí debe terminar correctamente antes de servir.
 */
export async function waitForDatabase({
  check,
  timeoutMs = 120_000,
  retryDelayMs = 2_000,
  now = Date.now,
  sleep = defaultSleep,
  onRetry,
}: WaitForDatabaseOptions): Promise<void> {
  const startedAt = now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      await check();
      return;
    } catch (error) {
      const elapsedMs = now() - startedAt;
      const remainingMs = timeoutMs - elapsedMs;
      if (remainingMs <= 0) throw error;

      onRetry?.(error, attempt, remainingMs);
      await sleep(Math.min(retryDelayMs, remainingMs));
    }
  }
}
