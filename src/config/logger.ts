// gym-remote-api/src/config/logger.ts
type LogLevel = "debug" | "info" | "warn" | "error";

const currentLevel: LogLevel = "debug";

/**
 * `JSON.stringify` de un `Error` da `{}`: sus campos no son enumerables.
 *
 * Medido el 17-08-2026, y costó una hora del recorrido de M4c: el evento que
 * atascó la cola se registró como `{"err":{}}`, así que el registro decía que
 * algo había fallado y no qué. Un error sin su mensaje es peor que ninguno,
 * porque parece que la avería está documentada.
 *
 * Se recorre en profundidad porque el error casi nunca va suelto: viaja dentro
 * de un objeto de contexto, que es de donde se sacan el evento y la entidad.
 */
function serializable(valor: unknown, profundidad = 0): unknown {
  if (valor instanceof Error) {
    return {
      mensaje: valor.message,
      nombre: valor.name,
      // La causa es lo que distingue «Prisma rechazó» de «la política rechazó».
      ...(valor.cause ? { causa: serializable(valor.cause, profundidad + 1) } : {}),
      pila: valor.stack?.split("\n").slice(0, 4).join(" | "),
    };
  }
  if (profundidad > 3 || valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) return valor.map((v) => serializable(v, profundidad + 1));
  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>).map(([k, v]) => [
      k,
      serializable(v, profundidad + 1),
    ]),
  );
}

function log(level: LogLevel, message: string, meta?: unknown) {
  const time = new Date().toISOString();
  const base = `[${time}] [${level.toUpperCase()}] ${message}`;
  if (meta) {
    console.log(base, JSON.stringify(serializable(meta)));
  } else {
    console.log(base);
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) =>
    currentLevel === "debug" && log("debug", msg, meta),
  info: (msg: string, meta?: unknown) => log("info", msg, meta),
  warn: (msg: string, meta?: unknown) => log("warn", msg, meta),
  error: (msg: string, meta?: unknown) => log("error", msg, meta)
};
