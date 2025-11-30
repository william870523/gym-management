# Security Hardening Documentation

Este documento detalla las capas de seguridad implementadas en `gym-remote-api`.

## 1. Headers de Seguridad y CORS

### Headers (src/config/security.ts)
Se aplican headers estándar para mitigar ataques comunes:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`: Bloqueo de cámara, micrófono, geolocalización, etc.
- `Content-Security-Policy (CSP)`: Bloquea scripts inline y restringe orígenes.

### CORS (src/config/cors.ts)
- **Orígenes permitidos**: Configurable vía `CORS_ALLOWED_ORIGINS`. Por defecto `*` (dev), pero debe restringirse en producción.
- **Métodos**: GET, POST, PUT, PATCH, DELETE, OPTIONS.
- **Credenciales**: Desactivadas por defecto.

## 2. Audit Logging

### Modelo (Prisma)
Tabla `security_audit_log`:
- `level`: INFO, WARN, ERROR.
- `category`: AUTH, RATE_LIMIT, ADMIN_ACTION, JWT.
- `action`: Evento específico (ej: LOGIN_FAILED).
- `metadata`: JSON con detalles adicionales.

### Uso
El servicio `auditSecurityEvent` (src/infrastructure/logging/audit-logger.ts) registra eventos de forma asíncrona y resiliente (no bloquea la request si falla la DB).

## 3. JWT Hardening

### Servicio (src/infrastructure/auth/jwt.service.ts)
Centraliza la firma y verificación de tokens.
- **Claims Estrictos**:
  - `iss` (Issuer): `gym-remote-api`
  - `aud` (Audience): `gym-clients`
  - `jti` (JWT ID): UUID único para cada token (permite futura revocación).
  - `sub`: ID del usuario o dispositivo.
- **Expiración**:
  - Admins: Configurable (default 1h).
  - Dispositivos: 30 días.

## 4. Bloqueo de IPs (Fail2Ban)

### Middleware (src/infrastructure/http/middleware/ip-block.middleware.ts)
Sistema in-memory para bloquear IPs tras múltiples intentos fallidos.
- **Umbral**: 10 intentos fallidos.
- **Ventana**: 10 minutos.
- **Bloqueo**: 15 minutos.
- **Respuesta**: 403 Forbidden ("Too many failed attempts...").

### Integración
Se aplica en `/auth/login` y `/auth/device-login`.

## Variables de Entorno Nuevas
- `CORS_ALLOWED_ORIGINS`: Lista de dominios permitidos (separados por coma).
- `JWT_ISSUER`: Emisor del token (opcional).
- `JWT_AUDIENCE`: Audiencia del token (opcional).
