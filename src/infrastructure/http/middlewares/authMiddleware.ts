// gym-remote-api/src/infrastructure/http/middlewares/authMiddleware.ts
import type { MiddlewareHandler } from "hono";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";
import { logger } from "../../../config/logger";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.substring("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as {
      sub: string;
      role: string;
    };

    // Guardamos el usuario en el contexto
    c.set("user", { id: payload.sub, role: payload.role });

    await next();
  } catch (err) {
    logger.warn("Invalid JWT", err);
    return c.json({ error: "Unauthorized" }, 401);
  }
};
