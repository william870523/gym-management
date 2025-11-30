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
  corsAllowedOrigins: getEnv("CORS_ALLOWED_ORIGINS", "*")
};
