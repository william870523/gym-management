import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export interface JwtPayload {
    sub?: string; // Subject (user_id or device_id)
    id?: string;  // Legacy support
    role: string;
    iss?: string; // Issuer
    aud?: string; // Audience
    jti?: string; // JWT ID
    device_id?: string; // For devices
    gym_id?: string;    // Context
    [key: string]: any;
}

const ISSUER = env.jwtIssuer || "gym-remote-api";
const AUDIENCE = env.jwtAudience || "gym-clients";

/**
 * Servicio centralizado para manejo de JWT
 */
export const JwtService = {
    /**
     * Genera un token para administrador
     */
    signAdminToken: (payload: { userId: string; role: string;[key: string]: any }): string => {
        const now = Math.floor(Date.now() / 1000);
        const jwtPayload = {
            ...payload,
            sub: payload.userId,
            iss: ISSUER,
            aud: AUDIENCE,
            jti: crypto.randomUUID(),
            iat: now,
        };

        return jwt.sign(jwtPayload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as any });
    },

    /**
     * Genera un token para dispositivo
     */
    signDeviceToken: (payload: { deviceId: string; gymId: string; role: string;[key: string]: any }): string => {
        const now = Math.floor(Date.now() / 1000);
        const jwtPayload = {
            ...payload,
            sub: payload.deviceId,
            iss: ISSUER,
            aud: AUDIENCE,
            jti: crypto.randomUUID(),
            iat: now,
        };

        // Dispositivos pueden tener expiración más larga o personalizada
        return jwt.sign(jwtPayload, env.jwtSecret, { expiresIn: "30d" });
    },

    /**
     * Verifica y decodifica un token
     */
    verifyToken: (token: string): JwtPayload => {
        try {
            const decoded = jwt.verify(token, env.jwtSecret, {
                issuer: ISSUER,
                audience: AUDIENCE,
                algorithms: ["HS256"]
            }) as JwtPayload;

            return decoded;
        } catch (error) {
            throw new Error("Invalid Token");
        }
    },

    /**
     * Decodifica sin verificar (útil para debug o inspección previa)
     */
    decodeToken: (token: string): JwtPayload | null => {
        return jwt.decode(token) as JwtPayload;
    }
};
