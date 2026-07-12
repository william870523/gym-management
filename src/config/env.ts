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
};
