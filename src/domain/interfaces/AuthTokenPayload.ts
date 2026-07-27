export interface AuthTokenPayload {
    sub: string;
    role: string;
    gymId?: string;
    deviceId?: string;
    /**
     * Dueño de la cadena. **No viaja en el JWT**: lo pone el middleware tras
     * leerlo de la base, para que la autoridad no dependa de un claim firmado
     * hace horas ni pueda quedarse obsoleta (docs/MULTI_SEDE.md §3).
     */
    esPlataforma?: boolean;
    iat?: number;
    exp?: number;
}
