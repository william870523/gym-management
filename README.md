# 🏋️ gym-remote-api

API remota para sistema de gestión de gimnasios, construida con Bun, Hono, Prisma y MariaDB.

Para producción, Docker, zonas horarias, varias sedes y sincronización, leer
[`../docs/TIME_SYNC_OPERATIONS.md`](../docs/TIME_SYNC_OPERATIONS.md) antes de
instalar o migrar.

## 📋 Características

- ✅ **Autenticación JWT** para usuarios y dispositivos
- ✅ **Autorización basada en roles** (admin, device)
- ✅ **CRUD completo** para todas las entidades
- ✅ **Sincronización de eventos** desde backends locales
- ✅ **Arquitectura limpia** (Clean Architecture)
- ✅ **Validación de datos** con Zod
- ✅ **TypeScript** para type safety

## 🚀 Inicio Rápido (Desarrollo)

### Prerequisitos

- [Bun](https://bun.sh) v1.x+
- MariaDB 10.6+
- Node.js 18+ (opcional, para compatibilidad)

### Instalación

```bash
# Clonar repositorio
git clone <repo-url>
cd gym-remote-api

# Instalar dependencias
bun install

# Copiar y configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Ejecutar migraciones de base de datos
bunx prisma migrate dev

# Generar cliente de Prisma
bunx prisma generate

# Iniciar servidor de desarrollo
bun src/infrastructure/http/server.ts
```

La API estará disponible en `http://localhost:8080`

## 📚 Documentación

- **[Guía de Despliegue HTTPS](docs/DEPLOYMENT_HTTPS.md)** - Deployment a producción con Nginx
- **[Configuración Nginx](infra/deploy/nginx-gym.conf)** - Ejemplo de configuración
- **[Walkthrough Auth](walkthrough.md)** - Implementación de autenticación

## 🔐 Autenticación

### Login de Usuario (Admin)

```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123"}'
```

### Login de Dispositivo

```bash
curl -X POST http://localhost:8080/auth/device-login \
  -H "Content-Type: application/json" \
  -d '{"device_id":"device-1","secret":"secret-key"}'
```

### Usar Token en Requests

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8080/nacionalidades
```

## 🧪 Testing

```bash
# Ejecutar tests de autenticación
bun scripts/test-auth.ts

# Ejecutar tests de CRUD
bun scripts/test-crud.ts
```

## 🏗️ Arquitectura

```
src/
├── application/        # Capa de aplicación
│   ├── dtos/          # Validación con Zod
│   └── use-cases/     # Lógica de negocio
├── domain/            # Capa de dominio
│   ├── entities/      # Entidades del dominio
│   └── repositories/  # Interfaces de repositorios
├── infrastructure/    # Capa de infraestructura
│   ├── http/         # Servidor HTTP (Hono)
│   │   ├── controllers/
│   │   ├── middleware/
│   │   └── routes/
│   └── repositories/ # Implementaciones Prisma
└── config/           # Configuración
```

## 🌐 Endpoints Principales

### Públicos
- `GET /health` - Health check
- `POST /auth/login` - Login de usuarios
- `POST /auth/device-login` - Login de dispositivos

### Protegidos (Admin)
- `/nacionalidades` - CRUD de nacionalidades
- `/monedas` - CRUD de monedas
- `/tipos-pago` - CRUD de tipos de pago
- `/clientes` - CRUD de clientes
- `/entrenadores` - CRUD de entrenadores
- ... (todos los endpoints CRUD)

### Protegidos (Device)
- `/sync/upload-events` - Subir eventos de sincronización
- `/sync/changes` - Obtener cambios desde servidor

## 📦 Tecnologías

- **Runtime**: Bun
- **Framework**: Hono
- **ORM**: Prisma
- **Database**: MariaDB
- **Validación**: Zod
- **Auth**: JWT (jsonwebtoken)
- **Passwords**: bcryptjs

## 🔒 Seguridad

- JWT con HS256
- Passwords hasheados con bcrypt
- Roles y permisos
- Rate limiting (en Nginx)
- HTTPS obligatorio en producción
- HSTS habilitado
- Headers de seguridad

## 📝 Variables de Entorno

Ver `.env.example` para la lista completa.

Esenciales:
- `DATABASE_URL` - Conexión a MariaDB
- `JWT_SECRET` - Secret para firmar JWTs
- `PORT` - Puerto del servidor (default: 8080)
- `NODE_ENV` - Entorno (development/production)

## 🚢 Despliegue a Producción

Ver [docs/DEPLOYMENT_HTTPS.md](docs/DEPLOYMENT_HTTPS.md) para guía completa.

Resumen:
1. Servidor Ubuntu/Debian con Nginx
2. Certificado SSL con Let's Encrypt
3. Reverse proxy Nginx → Bun (localhost:8080)
4. Servicio systemd para auto-inicio
5. Backups automáticos de DB

## 🤝 Contribución

1. Fork el proyecto
2. Crear rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## 📄 Licencia

[Especificar licencia]

## 👥 Contacto

[Información de contacto]
