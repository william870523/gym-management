// gym-remote-api/src/config/logger.ts
type LogLevel = "debug" | "info" | "warn" | "error";

const currentLevel: LogLevel = "debug";

function log(level: LogLevel, message: string, meta?: unknown) {
  const time = new Date().toISOString();
  const base = `[${time}] [${level.toUpperCase()}] ${message}`;
  if (meta) {
    console.log(base, JSON.stringify(meta));
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
