export interface AuthTokenPayload {
    sub: string;
    role: string;
    gymId?: string;
    deviceId?: string;
    iat?: number;
    exp?: number;
}
