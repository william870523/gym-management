# 📱 GUÍA COMPLETA: Registrar y Autenticar Dispositivos

## 🎯 Flujo Completo de Dispositivos

### Paso 1: Registrar un Nuevo Dispositivo

**Endpoint:**
```http
POST http://localhost:3001/gyms/devices
```

**Headers:**
```
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

⚠️ **IMPORTANTE:** Necesitas estar autenticado como ADMIN para registrar dispositivos.

**Body (JSON):**
```json
{
  "device_id": "dispositivo-001",
  "gym_id": "gym-1",
  "nombre": "Dispositivo Principal",
  "tipo": "BACKEND_OFFLINE",
  "descripcion": "Dispositivo para sincronización local",
  "secret_key": "mi-secreto-super-seguro-123",
  "is_active": true,
  "activo": true
}
```

**Campos Obligatorios:**
- `device_id`: ID único del dispositivo (string)
- `gym_id`: ID del gimnasio al que pertenece
- `nombre`: Nombre descriptivo del dispositivo
- `secret_key`: Secreto para autenticación (mínimo 8 caracteres recomendado)

**Campos Opcionales:**
- `tipo`: Tipo de dispositivo (ej: "BACKEND_OFFLINE", "TABLET", "PC")
- `descripcion`: Descripción adicional
- `is_active`: Si el dispositivo está activo (default: true)
- `activo`: Estado activo (default: true)

**Respuesta Exitosa (201):**
```json
{
  "device_id": "dispositivo-001",
  "gym_id": "gym-1",
  "nombre": "Dispositivo Principal",
  "tipo": "BACKEND_OFFLINE",
  "secret_key": "mi-secreto-super-seguro-123",
  "is_active": true,
  "activo": true,
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T10:00:00.000Z"
}
```

---

### Paso 2: Autenticar el Dispositivo (Login)

**Endpoint:**
```http
POST http://localhost:3001/auth/device-login
```

**Headers:**
```
Content-Type: application/json
```

⚠️ **NO requiere token** - Este es un endpoint público para login

**Body (JSON):**
```json
{
  "device_id": "dispositivo-001",
  "secret": "mi-secreto-super-seguro-123"
}
```

**Respuesta Exitosa (200):**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "device_id": "dispositivo-001",
  "gym_id": "gym-1"
}
```

**⚠️ GUARDAR EL TOKEN:** Copiar el `token` a la variable `{{device_token}}`

**Script para Auto-Guardar en Postman (Tests tab):**
```javascript
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    pm.collectionVariables.set("device_token", jsonData.token);
    console.log("✅ Device token guardado:", jsonData.token);
}
```

---

### Paso 3: Usar el Token de Dispositivo

Ahora puedes acceder a los endpoints de sincronización:

#### Subir Eventos
```http
POST http://localhost:3001/sync/upload-events
Authorization: Bearer {{device_token}}
Content-Type: application/json

{
  "events": [
    {
      "event_id": "evt-001",
      "entidad": "cliente",
      "operacion": "CREATE",
      "entidad_id": "CLI123",
      "gym_id": "gym-1",
      "device_id": "dispositivo-001",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "data": {
        "ci": "CLI123",
        "nombres": "Pedro",
        "apellidos": "Ramírez"
      }
    }
  ]
}
```

#### Obtener Cambios
```http
GET http://localhost:3001/sync/changes?since=2024-01-01T00:00:00.000Z
Authorization: Bearer {{device_token}}
```

---

## 📋 CRUD Completo de Dispositivos

**TODOS requieren Admin Token:**
```
Authorization: Bearer {{admin_token}}
```

### Listar Todos los Dispositivos
```http
GET http://localhost:3001/gyms/devices
Authorization: Bearer {{admin_token}}
```

### Obtener Dispositivo por ID
```http
GET http://localhost:3001/gyms/devices/dispositivo-001
Authorization: Bearer {{admin_token}}
```

### Actualizar Dispositivo
```http
PUT http://localhost:3001/gyms/devices/dispositivo-001
Authorization: Bearer {{admin_token}}
Content-Type: application/json

{
  "nombre": "Dispositivo Principal Actualizado",
  "descripcion": "Nueva descripción",
  "is_active": true
}
```

### Eliminar Dispositivo (Soft Delete)
```http
DELETE http://localhost:3001/gyms/devices/dispositivo-001
Authorization: Bearer {{admin_token}}
```

---

## 🔧 Flujo COMPLETO en Postman - Paso a Paso

### 1️⃣ Login como Admin
```http
POST http://localhost:3001/auth/login

{
  "email": "admin@test.com",
  "password": "admin123"
}
```

**Guardar el token en `{{admin_token}}`**

---

### 2️⃣ Verificar que existe un Gimnasio
```http
GET http://localhost:3001/gyms
Authorization: Bearer {{admin_token}}
```

Si no existe, crear uno primero (ver documentación de gyms).

---

### 3️⃣ Registrar un Dispositivo
```http
POST http://localhost:3001/gyms/devices
Authorization: Bearer {{admin_token}}
Content-Type: application/json

{
  "device_id": "mi-dispositivo-postman",
  "gym_id": "gym-1",
  "nombre": "Dispositivo de Prueba Postman",
  "tipo": "BACKEND_OFFLINE",
  "descripcion": "Para testing con Postman",
  "secret_key": "postman-secret-2024",
  "is_active": true,
  "activo": true
}
```

---

### 4️⃣ Autenticar el Dispositivo
```http
POST http://localhost:3001/auth/device-login
Content-Type: application/json

{
  "device_id": "mi-dispositivo-postman",
  "secret": "postman-secret-2024"
}
```

**Guardar el token en `{{device_token}}`**

---

### 5️⃣ Probar Sincronización
```http
POST http://localhost:3001/sync/upload-events
Authorization: Bearer {{device_token}}
Content-Type: application/json

{
  "events": [
    {
      "event_id": "test-event-001",
      "entidad": "cliente",
      "operacion": "CREATE",
      "entidad_id": "TEST-CLI-001",
      "gym_id": "gym-1",
      "device_id": "mi-dispositivo-postman",
      "timestamp": "2024-01-15T12:00:00.000Z",
      "data": {
        "ci": "TEST-CLI-001",
        "nombres": "Cliente",
        "apellidos": "De Prueba"
      }
    }
  ]
}
```

---

## ⚠️ Errores Comunes

### 401: Unauthorized - Token required
**Causa:** No se envió el token de autenticación

**Solución:**
- Para registrar/modificar dispositivos: Usar `{{admin_token}}`
- Para autenticar dispositivo: NO requiere token
- Para usar /sync: Usar `{{device_token}}`

---

### 403: Forbidden - Device role required
**Causa:** Intentaste acceder a /sync con admin_token en lugar de device_token

**Solución:**
- Hacer device-login primero
- Usar el token de dispositivo

---

### 404: Not Found
**Causa:** La ruta no existe

**Solución:**
- Dispositivos se registran en: `/gyms/devices` (NO `/devices`)
- Autenticación de dispositivos: `/auth/device-login`

---

### 409: Email/ID already registered
**Causa:** El device_id ya existe

**Solución:**
- Usar un device_id diferente
- O actualizar el dispositivo existente con PUT

---

## 📝 Campos Importantes

### secret_key vs secret
- `secret_key`: Se usa al **REGISTRAR** el dispositivo (campo en la BD)
- `secret`: Se usa al **AUTENTICAR** el dispositivo (campo en el login)
- **Deben ser el mismo valor**

### is_active
- Si `is_active = false`, el dispositivo NO puede autenticarse
- Debe estar en `true` para permitir login

### device_id
- Debe ser único
- Se usa tanto para registro como para autenticación
- Ejemplo: "dispositivo-001", "tablet-gym-central", "backend-local-1"

---

## ✅ Checklist de Verificación

Antes de probar:
- [ ] Servidor corriendo en puerto 3001
- [ ] Usuario admin existe en la BD
- [ ] Admin token guardado en variable de Postman
- [ ] Gimnasio existe (gym_id válido)

Flujo de prueba:
1. [ ] Login admin → Token guardado
2. [ ] Registrar dispositivo → 201 Created
3. [ ] Autenticar dispositivo → 200 OK + token
4. [ ] Token de dispositivo guardado
5. [ ] Probar endpoint /sync → 200 OK

---

## 🚀 Ejemplo Mínimo Funcional

```javascript
// 1. Login Admin
POST /auth/login
{ "email": "admin@test.com", "password": "admin123" }
→ Guardar admin_token

// 2. Registrar Dispositivo
POST /gyms/devices (con admin_token)
{
  "device_id": "device-001",
  "gym_id": "gym-1",
  "nombre": "Mi Dispositivo",
  "secret_key": "mysecret123",
  "is_active": true
}

// 3. Login Dispositivo
POST /auth/device-login (SIN token)
{ "device_id": "device-001", "secret": "mysecret123" }
→ Guardar device_token

// 4. Usar Sync
POST /sync/upload-events (con device_token)
{ "events": [...] }
```

¡Listo! 🎉
