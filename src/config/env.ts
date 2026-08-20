// gym-remote-api/src/config/env.ts
import "dotenv/config";

function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export const env = {
  nodeEnv: getEnv("NODE_ENV", "development"),
  port: parseInt(getEnv("PORT", "8080"), 10),
  dbUrl: getEnv("DATABASE_URL"),
  jwtSecret: getEnv("JWT_SECRET"),
  jwtExpiresIn: getEnv("JWT_EXPIRES_IN", "1h"),
  jwtIssuer: getEnv("JWT_ISSUER", "gym-remote-api"),
  jwtAudience: getEnv("JWT_AUDIENCE", "gym-clients"),
  corsAllowedOrigins: getEnv("CORS_ALLOWED_ORIGINS", "*"),
  defaultGymTimezone: getEnv("GYM_TIMEZONE", "Etc/UTC"),
  timeAuthorityUrl: getEnv(
    "TIME_AUTHORITY_URL",
    "https://www.google.com/generate_204",
  ),
  timeSyncIntervalMs: parseInt(getEnv("TIME_SYNC_INTERVAL_MS", "300000"), 10),
  timeSyncTimeoutMs: parseInt(getEnv("TIME_SYNC_TIMEOUT_MS", "5000"), 10),
  // M4a §9-bis: cada cuánto se barren las copias de visitante caducadas, y
  // el interruptor para apagarlo. Doce horas porque el plus vence por día de
  // negocio y las sedes están en husos distintos: una sola pasada diaria
  // dejaría a alguna sede medio día con copias que ya no aplican.
  barridoVisitantesHoras: parseInt(getEnv("BARRIDO_VISITANTES_HORAS", "12"), 10),
  barridoVisitantesHabilitado:
    getEnv("BARRIDO_VISITANTES", "on").trim().toLowerCase() !== "off",
  // §6.4: cada cuánto se repasan los sellos de los certificados. Veinticuatro
  // horas y no doce como el barrido porque aquí no caduca nada: lo que se busca
  // es enterarse de una corrupción en reposo, no llegar a tiempo a una fecha.
  auditoriaSellosHoras: parseInt(getEnv("AUDITORIA_SELLOS_HORAS", "24"), 10),
  auditoriaSellosHabilitada:
    getEnv("AUDITORIA_SELLOS", "on").trim().toLowerCase() !== "off",
};
