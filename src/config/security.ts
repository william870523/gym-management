// gym-remote-api/src/config/security.ts
import type { MiddlewareHandler } from "hono";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  // Headers estándar de seguridad
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");

  // Content Security Policy (CSP)
  // Bloquea scripts inline, solo permite cargar recursos del mismo origen (self)
  // Ajustar según necesidades reales (ej: si usas CDN para fuentes/imágenes)
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
  );

  await next();
};
