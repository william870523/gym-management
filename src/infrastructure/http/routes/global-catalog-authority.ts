import type { MiddlewareHandler } from "hono";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

/** Los catálogos de identidad universal solo cambian desde la autoridad de cadena. */
export const requirePlatformAuthority: MiddlewareHandler = async (c, next) => {
  const auth = c.get("auth") as AuthTokenPayload | undefined;
  if (auth?.esPlataforma === true) return next();
  return c.json({
    error: "Esta acción global es del dueño de la cadena",
    error_code: "PLATFORM_AUTHORITY_REQUIRED",
  }, 403);
};
