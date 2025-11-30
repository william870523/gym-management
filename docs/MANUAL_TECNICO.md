# 📘 Manual Técnico - Gym Remote API

**Versión:** 1.0.0
**Fecha:** 23 de Noviembre, 2025

## 1. Introducción y Propósito

**Gym Remote API** es el backend centralizado para la gestión de una cadena de gimnasios. Su propósito principal es servir como la "fuente de la verdad" para múltiples sucursales, permitiendo:

1.  **Centralización de Datos:** Catálogos globales (monedas, nacionalidades, tipos de pago) y configuración.
2.  **Sincronización Bidireccional:** Los gimnasios locales (que pueden operar offline) sincronizan sus datos con esta API cuando tienen conexión.
3.  **Gestión Multi-Sucursal:** Soporte para múltiples gimnasios (`gym_id`) y dispositivos (`device_id`).
4.  **Seguridad:** Autenticación robusta para administradores y dispositivos.

Este sistema está diseñado bajo una arquitectura **Offline-First**, donde la API Remota actúa como el servidor maestro y las APIs Locales (en cada gimnasio) actúan como esclavos que replican datos.

---

## 2. Arquitectura del Sistema

El sistema sigue una arquitectura de **Clean Architecture** (Arquitectura Limpia) para desacoplar la lógica de negocio de la infraestructura.

```mermaid
graph TD
    Client[Cliente HTTP / Postman / App Local] -->|JSON| Server[Servidor Hono (Bun)]
    Server -->|Rutas| Controller[Controladores (Infrastructure)]
    Controller -->|DTOs| UseCase[Casos de Uso (Application)]
    UseCase -->|Interfaces| Repository[Repositorios (Domain/Interface)]
    Repository -->|Implementación| Prisma[Prisma ORM (Infrastructure)]
    Prisma -->|SQL| DB[(Base de Datos MariaDB/MySQL)]
```

### Flujo de Sincronización
1.  **Local -> Remoto (Upload):** Los gimnasios envían eventos (`sync_log`) de lo que ocurrió localmente (ej: nuevo cliente).
2.  **Remoto -> Local (Download):** Los gimnasios consultan cambios pendientes (`get-changes`) ocurridos en otros lados o en el central.

---

## 3. Stack Tecnológico

*   **Runtime:** [Bun](https://bun.sh/) (v1.x) - Un runtime de JavaScript ultra-rápido.
*   **Framework Web:** [Hono](https://hono.dev/) - Ligero, rápido y compatible con estándares web.
*   **ORM:** [Prisma](https://www.prisma.io/) - Para interactuar con la base de datos de forma segura y tipada.
*   **Base de Datos:** MariaDB o MySQL.
*   **Lenguaje:** TypeScript (Estricto).
*   **Autenticación:** JWT (JSON Web Tokens) + bcryptjs.
*   **Validación:** Zod.

---

## 4. Estructura del Proyecto

La estructura de carpetas está diseñada para ser escalable y mantenible:

```
gym-remote-api/
├── src/
│   ├── application/          # Lógica de Negocio Pura
│   │   ├── use-cases/        # Casos de Uso (ej: CreateUser, SyncEvents)
│   │   ├── dtos/             # Data Transfer Objects (Interfaces de entrada/salida)
│   │   └── validation/       # Esquemas de validación Zod
│   ├── domain/               # Reglas de Negocio y Entidades
│   │   ├── entities/         # Definiciones de tipos/clases (ej: User, Gym)
│   │   └── repositories/     # Interfaces de Repositorios (contratos)
│   ├── infrastructure/       # Implementación Técnica
│   │   ├── http/             # Capa HTTP (Servidor, Controladores, Rutas, Middleware)
│   │   ├── db/               # Configuración de Base de Datos (Prisma Client)
│   │   └── repositories/     # Implementación de Repositorios con Prisma
│   └── config/               # Configuración global (Variables de entorno, Logger)
├── prisma/                   # Esquema de Base de Datos y Migraciones
├── docs/                     # Documentación (este manual, guías de despliegue)
├── scripts/                  # Scripts de utilidad (seed, test, verify)
└── infra/                    # Configuración de infraestructura (Nginx, Docker)
```

---

## 5. Instalación y Configuración (Desde Cero)

### Requisitos Previos
*   [Bun](https://bun.sh/) instalado.
*   Servidor MySQL o MariaDB corriendo.
*   Git.

### Pasos
1.  **Clonar el Repositorio:**
    ```bash
    git clone <url-del-repo>
    cd gym-remote-api
    ```

2.  **Instalar Dependencias:**
    ```bash
    bun install
    ```

3.  **Configurar Variables de Entorno:**
    Crea un archivo `.env` en la raíz:
    ```env
    DATABASE_URL="mysql://usuario:password@localhost:3306/gym_db"
    JWT_SECRET="tu_secreto_super_seguro"
    PORT=3001
    NODE_ENV="development"
    ```

4.  **Configurar Base de Datos:**
    ```bash
    # Crear tablas y aplicar migraciones
    bunx prisma migrate dev --name init
    
    # Generar cliente de Prisma
    bunx prisma generate
    ```

5.  **Cargar Datos Iniciales (Seed):**
    Puedes usar el script SQL provisto o crear un seed personalizado.
    ```bash
    mysql -u usuario -p gym_db < scripts/setup-postman-data.sql
    ```

6.  **Iniciar Servidor:**
    ```bash
    bun run dev
    ```
    El servidor iniciará en `http://localhost:3001`.

---

## 6. Base de Datos (Esquema Simplificado)

El esquema completo está en `prisma/schema.prisma`. Las tablas principales son:

*   **`gym`**: Sucursales.
*   **`device`**: Dispositivos autorizados (tablets, torniquetes).
*   **`user`**: Administradores del sistema.
*   **`sync_log`**: Bitácora de eventos para sincronización.
*   **Catálogos**: `monedas`, `nacionalidades`, `tipos_pago`, etc.
*   **Negocio**: `cliente`, `asistencia`, `pago_cliente`, `detalle_pago`.

---

## 7. API Reference (Resumen)

Todas las respuestas son JSON.

### Autenticación
*   `POST /auth/login`: Login de administrador.
*   `POST /auth/device-login`: Login de dispositivo.
*   `POST /auth/register`: Registrar nuevo usuario.

### Sincronización (Requiere Token de Dispositivo)
*   `POST /sync/upload-events`: Subir cambios locales.
*   `GET /sync/changes`: Descargar cambios remotos.

### Gestión (Requiere Token de Admin)
*   **Gimnasios:** `/gyms`, `/gyms/devices`
*   **Catálogos:** `/monedas`, `/nacionalidades`, `/tipos-pago`, `/horarios`
*   **Clientes:** `/clientes`, `/clientes/:ci/pesos`, `/clientes/:ci/asistencias`
*   **Pagos:** `/pagos`, `/detalles-pago`

---

## 8. Sistema de Sincronización

El corazón del sistema es la tabla `sync_log`.

1.  **Estructura del Evento:**
    *   `event_id`: UUID único.
    *   `table_name`: Tabla afectada (ej: 'cliente').
    *   `action`: 'CREATE', 'UPDATE', 'DELETE'.
    *   `data`: JSON con los datos.
    *   `gym_id`: Origen del cambio.

2.  **Lógica:**
    *   Cuando un cliente se crea en local, se guarda en `sync_log` local.
    *   El dispositivo envía ese log a `/sync/upload-events`.
    *   El servidor remoto procesa el evento y lo aplica a su base de datos central.
    *   El servidor remoto guarda un registro en su propio `sync_log` para que *otros* gimnasios se enteren.

---

## 9. Seguridad

1.  **JWT (JSON Web Tokens):** Todo endpoint protegido requiere un header `Authorization: Bearer <token>`.
2.  **Roles:**
    *   `admin`: Acceso total a CRUDs.
    *   `device`: Acceso solo a Sincronización.
3.  **Middleware:** Se valida el token antes de llegar al controlador.
4.  **Passwords:** Hashed con `bcryptjs`.

---

## 10. Despliegue en Producción

Se recomienda usar **Nginx** como Reverse Proxy para manejar HTTPS y seguridad.

1.  **Ejecutar con PM2 o Docker:** Para mantener el proceso vivo.
2.  **Nginx Config:**
    ```nginx
    server {
        listen 443 ssl;
        server_name api.tugimnasio.com;
        
        location / {
            proxy_pass http://localhost:3001;
            # ... headers ...
        }
    }
    ```
    *(Ver `docs/DEPLOYMENT_HTTPS.md` para detalles completos)*.

---

## 11. Próximos Pasos y Mejoras Futuras

Para llevar este proyecto al siguiente nivel, se sugiere implementar:

1.  **Frontend de Administración:** Un panel web (React/Vue) para que los administradores gestionen los datos visualmente.
2.  **Reportes y Dashboards:** Estadísticas de asistencia, ingresos mensuales, clientes activos vs inactivos.
3.  **Integración de Pagos Online:** Stripe o PayPal para cobros automáticos.
4.  **Notificaciones Push:** Avisar a los clientes sobre vencimientos o promociones.
5.  **Tests Unitarios (Jest/Vitest):** Aumentar la cobertura de pruebas para lógica de negocio compleja.
6.  **CI/CD:** Pipelines automáticos para despliegue.

---

**Autor:** Equipo de Desarrollo (Asistido por Antigravity AI)
