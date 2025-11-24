# Guía Completa de Postman - gym-remote-api

Esta guía te permite probar TODOS los endpoints de la API en el orden correcto usando Postman.

## 📋 Índice

1. [Configuración Inicial](#configuración-inicial)
2. [Variables de Entorno](#variables-de-entorno)
3. [Flujo de Prueba Completo](#flujo-de-prueba-completo)
4. [Endpoints Públicos](#endpoints-públicos)
5. [Autenticación](#autenticación)
6. [Endpoints Admin (CRUD)](#endpoints-admin-crud)
7. [Endpoints de Sincronización (Device)](#endpoints-de-sincronización-device)
8. [Ejemplos de Payloads](#ejemplos-de-payloads)

---

## Configuración Inicial

### 1. Crear Colección en Postman

1. Abrir Postman
2. Click en "New" → "Collection"
3. Nombre: `gym-remote-api`

### 2. Configurar Variables de Colección

En la colección, ir a "Variables" y agregar:

| Variable | Initial Value | Current Value |
|----------|---------------|---------------|
| `base_url` | `http://localhost:8080` | `http://localhost:8080` |
| `admin_token` | _(vacío)_ | _(vacío)_ |
| `device_token` | _(vacío)_ | _(vacío)_ |

---

## Variables de Entorno

### Variables que se Actualizan Automáticamente

Después de login, usar estos scripts en Postman para capturar tokens:

**Para /auth/login (Admin):**
```javascript
// En la pestaña "Tests" del request
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    pm.collectionVariables.set("admin_token", jsonData.token);
    console.log("✅ Admin token guardado:", jsonData.token);
}
```

**Para /auth/device-login (Device):**
```javascript
// En la pestaña "Tests" del request
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    pm.collectionVariables.set("device_token", jsonData.token);
    console.log("✅ Device token guardado:", jsonData.token);
}
```

---

## Flujo de Prueba Completo

### ✅ Orden Recomendado de Prueba

```
1. Health Check (público)
2. Crear Usuario Admin en BD (manual/script)
3. Login Admin (POST /auth/login)
4. Crear Gimnasio (si no existe)
5. Crear Dispositivo con secret_key
6. Login Device (POST /auth/device-login)
7. Probar Endpoints CRUD (con admin_token)
8. Probar Endpoints Sync (con device_token)
```

---

## Endpoints Públicos

### 🟢 Health Check

```
GET {{base_url}}/health
```

**Headers:** Ninguno requerido

**Respuesta Esperada:**
```json
{
  "status": "ok-remote"
}
```

---

## Autenticación

### 🆕 Registrar Nuevo Usuario

```
POST {{base_url}}/auth/register
```

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "user_nombre": "Juan Pérez",
  "user_email": "juan@ejemplo.com",
  "password": "miPassword123",
  "role": "admin"
}
```

**Campos:**
- `user_nombre`: Nombre completo del usuario (requerido)
- `user_email`: Email único (requerido, debe ser válido)
- `password`: Contraseña (requerido, mínimo 6 caracteres)
- `role`: Rol del usuario (opcional, default: "user", valores: "admin" | "user")

**Respuesta Exitosa (201):**
```json
{
  "ok": true,
  "message": "Usuario registrado exitosamente",
  "user_id": "uuid-generado-automaticamente",
  "email": "juan@ejemplo.com",
  "role": "admin"
}
```

**Errores Posibles:**

**400 Bad Request** - Datos inválidos:
```json
{
  "error": "Datos inválidos",
  "details": [
    {
      "path": ["password"],
      "message": "Password debe tener al menos 6 caracteres"
    }
  ]
}
```

**409 Conflict** - Email ya registrado:
```json
{
  "error": "El email ya está registrado"
}
```

**⚠️ IMPORTANTE:** 
- Una vez registrado, usar el email y password en `/auth/login` para obtener el token
- Por defecto crea usuarios con role="user", cambiar a "admin" si necesitas permisos administrativos

---

### 🔐 Login de Usuario Admin

```
POST {{base_url}}/auth/login
```

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "email": "admin@test.com",
  "password": "admin123"
}
```

**Respuesta Exitosa (200):**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "admin-user-id",
  "role": "admin"
}
```

**⚠️ IMPORTANTE:** Copiar el `token` y guardarlo en la variable `admin_token`.

**Script para Auto-Guardar (Tests tab):**
```javascript
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    pm.collectionVariables.set("admin_token", jsonData.token);
}
```

---

### 🔐 Login de Dispositivo

```
POST {{base_url}}/auth/device-login
```

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "device_id": "test-device-id",
  "secret": "secret123"
}
```

**Respuesta Exitosa (200):**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "device_id": "test-device-id",
  "gym_id": "gym-1"
}
```

**Script para Auto-Guardar (Tests tab):**
```javascript
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    pm.collectionVariables.set("device_token", jsonData.token);
}
```

---

## Endpoints Admin (CRUD)

**🔒 TODOS estos endpoints requieren header de autenticación Admin:**

```
Authorization: Bearer {{admin_token}}
```

### Estructura General CRUD

Para cada entidad, los endpoints siguen este patrón:

```
GET    {{base_url}}/[entidad]              → Listar todos
GET    {{base_url}}/[entidad]/:id          → Obtener por ID
POST   {{base_url}}/[entidad]              → Crear nuevo
PUT    {{base_url}}/[entidad]/:id          → Actualizar
DELETE {{base_url}}/[entidad]/:id          → Eliminar (soft delete)
```

---

### 1️⃣ Monedas

#### Listar Monedas
```
GET {{base_url}}/monedas
Authorization: Bearer {{admin_token}}
```

#### Crear Moneda
```
POST {{base_url}}/monedas
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "moneda_nombre": "Dólar Estadounidense",
  "codigo": "USD",
  "simbolo": "$"
}
```

#### Actualizar Moneda
```
PUT {{base_url}}/monedas/{{moneda_id}}
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "moneda_nombre": "Dólar USA",
  "simbolo": "US$"
}
```

#### Eliminar Moneda
```
DELETE {{base_url}}/monedas/{{moneda_id}}
Authorization: Bearer {{admin_token}}
```

---

### 2️⃣ Nacionalidades

#### Crear Nacionalidad
```
POST {{base_url}}/nacionalidades
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "nacionalidad_nombre": "Paraguaya",
  "codigo_iso": "PRY"
}
```

#### Listar Nacionalidades
```
GET {{base_url}}/nacionalidades
Authorization: Bearer {{admin_token}}
```

#### Obtener Nacionalidad por ID
```
GET {{base_url}}/nacionalidades/{{nacionalidad_id}}
Authorization: Bearer {{admin_token}}
```

#### Actualizar Nacionalidad
```
PUT {{base_url}}/nacionalidades/{{nacionalidad_id}}
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "nacionalidad_nombre": "Paraguaya (Paraguay)"
}
```

---

### 3️⃣ Tipos de Pago

#### Crear Tipo de Pago
```
POST {{base_url}}/tipos-pago
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "nombre_tipo_pago": "Efectivo"
}
```

**Otros ejemplos:**
```json
{ "nombre_tipo_pago": "Tarjeta de Crédito" }
{ "nombre_tipo_pago": "Transferencia Bancaria" }
{ "nombre_tipo_pago": "Cheque" }
```

---

### 4️⃣ Tipos de Cambio

#### Crear Tipo de Cambio
```
POST {{base_url}}/tipos-cambio
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "moneda_id_base": "{{moneda_usd_id}}",
  "moneda_id_target": "{{moneda_gs_id}}",
  "exchange_rate": 7200.50,
  "fecha_inicio": "2024-01-01T00:00:00.000Z",
  "activo": true
}
```

---

### 5️⃣ Referencias

#### Crear Referencia
```
POST {{base_url}}/referencias
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "nombre_referencia": "Redes Sociales"
}
```

**Otros ejemplos:**
```json
{ "nombre_referencia": "Recomendación de Amigo" }
{ "nombre_referencia": "Publicidad en Radio" }
{ "nombre_referencia": "Búsqueda en Google" }
```

---

### 6️⃣ Horarios

#### Crear Horario
```
POST {{base_url}}/horarios
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "nombre_horario": "Mañana",
  "hora_inicio": 6,
  "hora_fin": 12
}
```

**⚠️ IMPORTANTE:** `hora_inicio` y `hora_fin` son números (0-23), no strings.

**Otros ejemplos:**
```json
{ "nombre_horario": "Tarde", "hora_inicio": 14, "hora_fin": 20 }
{ "nombre_horario": "Noche", "hora_inicio": 18, "hora_fin": 22 }
```

---

### 7️⃣ Planes de Pago

#### Crear Plan de Pago
```
POST {{base_url}}/planes-pago
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "nombre_plan_pago": "Mensual",
  "importe_plan_pago": 150000,
  "duracion_plan_pago": 30,
  "moneda_id": "{{moneda_id}}",
  "activo": true
}
```

**Otros ejemplos:**
```json
{
  "nombre_plan_pago": "Trimestral",
  "importe_plan_pago": 400000,
  "duracion_plan_pago": 90,
  "moneda_id": "{{moneda_id}}",
  "activo": true
}
```

---

### 8️⃣ Cuentas

#### Crear Cuenta
```
POST {{base_url}}/cuentas
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "nombre_cuenta": "Caja Principal",
  "moneda_id": "{{moneda_id}}"
}
```

---

### 9️⃣ Entrenadores

#### Crear Entrenador
```
POST {{base_url}}/entrenadores
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "ci_entrenador": "1234567",
  "nombres_entrenador": "Juan Carlos",
  "apellidos_entrenador": "González Pérez",
  "sexo_entrenador": "M",
  "direccion_entrenador": "Av. España 1234",
  "telefono_entrenador": 595981234567,
  "correo_entrenador": "juan@gym.com",
  "activo_entrenador": true,
  "fecha_incio_entrenador": "2024-01-01T00:00:00.000Z"
}
```

---

### 🔟 Clientes

#### Crear Cliente
```
POST {{base_url}}/clientes
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "ci": "9876543",
  "nombres": "María",
  "apellidos": "López",
  "sexo": "F",
  "cliente_peso_id": "peso-inicial-id",
  "estatura_cliente": 1.65,
  "direccion": "Calle Principal 456",
  "telefono": 595984567890,
  "nacionalidad_id": "{{nacionalidad_id}}",
  "correo": "maria@email.com",
  "objetivo": "Bajar de peso",
  "id_planes_pago": "{{plan_pago_id}}",
  "id_entrenador": "{{entrenador_id}}",
  "fecha_inicio": "2024-01-15T00:00:00.000Z",
  "fecha_fin": "2024-02-15T00:00:00.000Z",
  "activo": true,
  "id_horarios": "{{horario_id}}",
  "referencia_id": "{{referencia_id}}"
}
```

**⚠️ Dependencias:**
- Requiere: `nacionalidad_id`, `horario_id`, `plan_pago_id`, `entrenador_id`, `referencia_id`
- Crear estas entidades primero antes de crear clientes

---

### 1️⃣1️⃣ Cliente Peso

#### Crear Cliente Peso
```
POST {{base_url}}/clientes-peso
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "ci": "9876543",
  "fecha": "2024-01-15T00:00:00.000Z",
  "peso": 75.5
}
```

**⚠️ Dependencia:** El cliente con ese CI debe existir primero.

---

### 1️⃣2️⃣ Asistencias

#### Crear Asistencia
```
POST {{base_url}}/asistencias
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "ci": "9876543"
}
```

**⚠️ Dependencia:** El cliente debe existir.

---

### 1️⃣3️⃣ Pagos de Cliente

#### Crear Pago de Cliente
```
POST {{base_url}}/pagos-cliente
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "ci": "9876543",
  "fecha": "2024-01-15T00:00:00.000Z",
  "monto_total": 150000,
  "id_entrenador": "{{entrenador_id}}",
  "id_planes_pago": "{{plan_pago_id}}",
  "moneda_id": "{{moneda_id}}"
}
```

---

### 1️⃣4️⃣ Detalles de Pago

#### Crear Detalle de Pago
```
POST {{base_url}}/detalles-pago
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "pago_cliente_id": "{{pago_cliente_id}}",
  "tipo_pago_id": "{{tipo_pago_id}}",
  "moneda_id": "{{moneda_id}}",
  "cuenta_id": "{{cuenta_id}}",
  "cantidad": 150000,
  "tipo_cambio_id": "{{tipo_cambio_id}}"
}
```

---

## Endpoints de Sincronización (Device)

**🔒 Estos endpoints requieren token de DISPOSITIVO:**

```
Authorization: Bearer {{device_token}}
```

### Subir Eventos

```
POST {{base_url}}/sync/upload-events
Authorization: Bearer {{device_token}}
Content-Type: application/json
```

**Body:**
```json
{
  "events": [
    {
      "event_id": "evt-001",
      "entidad": "cliente",
      "operacion": "CREATE",
      "entidad_id": "CLI123",
      "gym_id": "gym-1",
      "device_id": "test-device-id",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "data": {
        "ci": "CLI123",
        "nombres": "Pedro",
        "apellidos": "Ramírez",
        "sexo": "M",
        "activo": true
      }
    }
  ]
}
```

### Obtener Cambios

```
GET {{base_url}}/sync/changes?since=2024-01-01T00:00:00.000Z
Authorization: Bearer {{device_token}}
```

**Query Params:**
- `since`: Timestamp ISO 8601 (opcional)

---

## 📝 Orden Lógico de Creación de Datos

Para evitar errores de dependencias, crear en este orden:

```
1. Monedas
2. Nacionalidades
3. Tipos de Pago
4. Tipos de Cambio (requiere 2 monedas)
5. Referencias
6. Horarios
7. Planes de Pago (requiere moneda)
8. Cuentas (requiere moneda)
9. Entrenadores
10. Clientes (requiere: nacionalidad, horario, plan, entrenador, referencia)
11. Cliente Peso (requiere cliente)
12. Asistencias (requiere cliente)
13. Pagos Cliente (requiere cliente, entrenador, plan, moneda)
14. Detalles Pago (requiere pago, tipo pago, moneda, cuenta, tipo cambio)
```

---

## 🧪 Colección de Postman Pre-configurada

### Estructura de Carpetas Recomendada

```
📁 gym-remote-api
├── 📁 0. Setup & Auth
│   ├── Health Check
│   ├── Login Admin
│   └── Login Device
├── 📁 1. Catálogos Base
│   ├── 📁 Monedas (5 requests)
│   ├── 📁 Nacionalidades (5 requests)
│   ├── 📁 Tipos de Pago (5 requests)
│   └── 📁 Referencias (5 requests)
├── 📁 2. Configuración
│   ├── 📁 Horarios (5 requests)
│   ├── 📁 Planes de Pago (5 requests)
│   ├── 📁 Cuentas (5 requests)
│   └── 📁 Tipos de Cambio (5 requests)
├── 📁 3. Personal
│   └── 📁 Entrenadores (5 requests)
├── 📁 4. Clientes y Registros
│   ├── 📁 Clientes (5 requests)
│   ├── 📁 Cliente Peso (5 requests)
│   ├── 📁 Asistencias (5 requests)
│   ├── 📁 Pagos Cliente (5 requests)
│   └── 📁 Detalles Pago (5 requests)
└── 📁 5. Sincronización
    ├── Upload Events
    └── Get Changes
```

---

## 🔧 Scripts de Preparación de Datos

### Script SQL para Crear Usuario Admin

Ejecutar en MariaDB antes de usar Postman:

```sql
-- Crear usuario admin (password: admin123)
INSERT INTO User (user_id, user_nombre, user_email, password, role, createdAt, is_deleted, created_at, updated_at, version)
VALUES (
  'admin-user-id',
  'Admin User',
  'admin@test.com',
  '$2a$10$rOqK9vN8K8qF7x.YR7C4w.V9UJxqKZE6HZHzKFJxKFJxKFJxKFJxK', -- bcrypt hash de "admin123"
  'admin',
  NOW(),
  FALSE,
  NOW(),
  NOW(),
  1
);

-- Crear gimnasio
INSERT INTO gym (gym_id, codigo, nombre, activo, created_at, updated_at)
VALUES ('gym-1', 'GYM1', 'Gimnasio Principal', TRUE, NOW(), NOW());

-- Crear dispositivo
INSERT INTO device (device_id, gym_id, nombre, tipo, secret_key, is_active, activo, created_at, updated_at)
VALUES (
  'test-device-id',
  'gym-1',
  'Dispositivo de Prueba',
  'BACKEND_OFFLINE',
  'secret123',
  TRUE,
  TRUE,
  NOW(),
  NOW()
);
```

### Script de Bun para Crear Usuario

Alternativamente, ejecutar:

```bash
bun scripts/test-auth.ts
```

Esto creará automáticamente el usuario admin y el dispositivo.

---

## ⚠️ Errores Comunes y Soluciones

### Error 401: Unauthorized

**Causa:** Token no proporcionado o inválido

**Solución:**
1. Hacer login primero
2. Copiar el token de la respuesta
3. Agregarlo en header: `Authorization: Bearer {{token}}`

### Error 403: Forbidden

**Causa:** Token de tipo incorrecto (ej: usando device token en endpoint admin)

**Solución:**
- Endpoints CRUD → Usar `admin_token`
- Endpoints /sync → Usar `device_token`

### Error 400: Bad Request

**Causa:** Payload inválido o campos faltantes

**Solución:**
1. Verificar que todos los campos requeridos estén presentes
2. Verificar tipos de datos (números vs strings)
3. Verificar formato de fechas (ISO 8601)

### Error 404: Not Found

**Causa:** ID no existe o fue eliminado (soft delete)

**Solución:**
- Verificar que el ID sea correcto
- Listar todos para obtener IDs válidos

---

## 💡 Tips y Mejores Prácticas

### 1. Usar Variables para IDs

Cuando crees un recurso, guarda su ID en una variable:

**Script en Tests:**
```javascript
if (pm.response.code === 201 || pm.response.code === 200) {
    const jsonData = pm.response.json();
    pm.collectionVariables.set("moneda_id", jsonData.moneda_id);
}
```

### 2. Tests Automáticos

Agregar en cada request:

```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has required fields", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('id');
});
```

### 3. Ambiente de Desarrollo vs Producción

Crear dos ambientes en Postman:

**Development:**
- `base_url`: `http://localhost:3001`

**Production:**
- `base_url`: `https://api.ejemplo.com`

---

## 📊 Resumen de Autenticación por Endpoint

| Endpoint | Autenticación | Token Requerido |
|----------|---------------|-----------------|
| `/health` | ❌ Ninguna | - |
| `/auth/login` | ❌ Ninguna | - |
| `/auth/device-login` | ❌ Ninguna | - |
| `/monedas/*` | ✅ Admin | `admin_token` |
| `/nacionalidades/*` | ✅ Admin | `admin_token` |
| `/tipos-pago/*` | ✅ Admin | `admin_token` |
| `/tipos-cambio/*` | ✅ Admin | `admin_token` |
| `/referencias/*` | ✅ Admin | `admin_token` |
| `/horarios/*` | ✅ Admin | `admin_token` |
| `/planes-pago/*` | ✅ Admin | `admin_token` |
| `/cuentas/*` | ✅ Admin | `admin_token` |
| `/entrenadores/*` | ✅ Admin | `admin_token` |
| `/clientes/*` | ✅ Admin | `admin_token` |
| `/clientes-peso/*` | ✅ Admin | `admin_token` |
| `/asistencias/*` | ✅ Admin | `admin_token` |
| `/pagos-cliente/*` | ✅ Admin | `admin_token` |
| `/detalles-pago/*` | ✅ Admin | `admin_token` |
| `/sync/*` | ✅ Device | `device_token` |

---

## 🚀 Listo para Empezar

1. ✅ Servidor corriendo en `http://localhost:3001`
2. ✅ Base de datos con usuario admin creado
3. ✅ Postman configurado con variables
4. ✅ Seguir orden de creación de datos
5. ✅ Usar tokens correctos según endpoint

**¡Feliz Testing! 🎉**
