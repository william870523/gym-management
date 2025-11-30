# Gym Management - Proyecto Offline/Online (William)

**Última Actualización:** 23 de Noviembre, 2025
**Documentación Técnica Detallada:** Ver `docs/MANUAL_TECNICO.md`

## 🎯 Objetivo General

Sistema para gestionar uno o varios gimnasios con arquitectura **Offline-First**:
- **Backend REMOTO (`gym-remote-api`):** Fuente de la verdad centralizada (MariaDB).
- **Backend LOCAL (`gym-local-api`):** Servidor en cada sucursal (SQLite) que funciona sin internet.
- **Frontend:** Aplicación Flutter (Desktop/Web) que se conecta al backend local.
- **Sincronización:** Bidireccional y basada en eventos.

---

## 🏗️ Arquitectura Implementada (Clean Architecture)

El proyecto sigue estrictamente **Clean Architecture**:
1.  **Domain:** Entidades y contratos de repositorios (Agnóstico).
2.  **Application:** Casos de uso (Lógica de negocio pura).
3.  **Infrastructure:** Implementaciones concretas (Prisma, Hono, JWT).
4.  **Presentation:** Controladores HTTP y Rutas.

---

## 🚀 Estado del Proyecto (Roadmap)

### ✅ FASE 1: Sincronización Remota (COMPLETADO)
- [x] Base de datos MariaDB normalizada.
- [x] Sistema de `sync_log` para registrar eventos.
- [x] Endpoint `POST /sync/upload-events` (Recepción de cambios locales).
- [x] Endpoint `GET /sync/changes` (Envío de cambios remotos).
- [x] Lógica de idempotencia y manejo de conflictos.

### ✅ FASE 2: CRUD Remoto Completo (COMPLETADO)
- [x] Implementación de patrón Repository para todas las entidades.
- [x] Casos de uso (Create, Update, Get, List, Delete) para:
    - Catálogos: Monedas, Nacionalidades, Tipos de Pago, etc.
    - Negocio: Clientes, Asistencias, Pagos, Entrenadores.
    - Configuración: Horarios, Planes, Cuentas.
    - Infraestructura: Gimnasios, Dispositivos.
- [x] Validaciones estrictas con **Zod** en todos los endpoints.
- [x] Rutas RESTful estandarizadas.

### ✅ FASE 3: Seguridad y Despliegue (COMPLETADO)
- [x] Autenticación JWT para Administradores (`/auth/login`).
- [x] Autenticación JWT para Dispositivos (`/auth/device-login`).
- [x] Middleware de protección de rutas (`authAdmin`, `authDevice`).
- [x] Hashing de contraseñas con `bcryptjs`.
- [x] Guía de despliegue HTTPS con Nginx (`docs/DEPLOYMENT_HTTPS.md`).
- [x] Manual Técnico completo (`docs/MANUAL_TECNICO.md`).

### 🚧 FASE 4: Backend Local (`gym-local-api`) (PENDIENTE)
*El siguiente gran paso es construir el espejo local.*
- [ ] Inicializar proyecto Bun + Prisma (SQLite).
- [ ] Replicar esquema de base de datos (adaptado a SQLite).
- [ ] Implementar `sync_outbox` (cola de salida) y `sync_inbox`.
- [ ] Crear Worker de Sincronización (Push/Pull automático).
- [ ] Exponer API local para el Frontend.

### 📅 FASE 5: Frontend (Flutter) (PENDIENTE)
- [ ] Pantallas de Login y Dashboard.
- [ ] Gestión de Clientes (Altas, Bajas, Fotos).
- [ ] Punto de Venta (Pagos, Planes).
- [ ] Control de Acceso (Torniquetes/Huella).
- [ ] Indicadores de estado de sincronización (Online/Offline).

---

## 🛠️ Tecnologías Clave
- **Runtime:** Bun
- **Framework:** Hono
- **ORM:** Prisma
- **DB Remota:** MariaDB/MySQL
- **DB Local:** SQLite
- **Auth:** JWT + Bcrypt
- **Validación:** Zod

---

## 📂 Referencia Rápida de Documentación
- **`docs/MANUAL_TECNICO.md`**: Explicación profunda de arquitectura y código.
- **`docs/API_QUICK_REFERENCE.md`**: Lista de endpoints para consumo.
- **`docs/DEPLOYMENT_HTTPS.md`**: Guía de puesta en producción.
- **`docs/POSTMAN_GUIDE.md`**: Cómo probar la API.
