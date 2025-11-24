# 🚀 QUICK REFERENCE - gym-remote-api Endpoints

## 🌐 Base URL
```
http://localhost:3001
```

## 🔑 Autenticación

### Registrar Usuario (NUEVO)
```http
POST /auth/register
{
  "user_nombre": "Juan Pérez",
  "user_email": "juan@email.com",
  "password": "password123",
  "role": "admin"
}
→ Retorna user_id, email, role (201 Created)
```

**Campos:**
- `user_nombre`: Nombre completo (requerido)
- `user_email`: Email único (requerido, válido)
- `password`: Mínimo 6 caracteres (requerido)
- `role`: "admin" o "user" (opcional, default: "user")

### Login Admin
```http
POST /auth/login
{ "email": "admin@test.com", "password": "admin123" }
→ Copiar token a variable {{admin_token}}
```

### Login Device
```http
POST /auth/device-login
{ "device_id": "test-device-id", "secret": "secret123" }
→ Copiar token a variable {{device_token}}
```

## 📍 Endpoints (Todos requieren Admin Token excepto /sync)

### Público
- `GET /health` → Sin autenticación

### Monedas (/monedas)
- `GET /monedas` → Listar
- `GET /monedas/:id` → Obtener
- `POST /monedas` → `{"moneda_nombre":"USD","codigo":"USD","simbolo":"$"}`
- `PUT /monedas/:id` → `{"moneda_nombre":"Dólar"}`
- `DELETE /monedas/:id`

### Nacionalidades (/nacionalidades)
- `GET /nacionalidades`
- `GET /nacionalidades/:id`
- `POST /nacionalidades` → `{"nacionalidad_nombre":"Paraguaya","codigo_iso":"PRY"}`
- `PUT /nacionalidades/:id`
- `DELETE /nacionalidades/:id`

### Tipos de Pago (/tipos-pago)
- `GET /tipos-pago`
- `GET /tipos-pago/:id`
- `POST /tipos-pago` → `{"nombre_tipo_pago":"Efectivo"}`
- `PUT /tipos-pago/:id`
- `DELETE /tipos-pago/:id`

### Tipos de Cambio (/tipos-cambio)
- `GET /tipos-cambio`
- `GET /tipos-cambio/:id`
- `POST /tipos-cambio` → `{"moneda_id_base":"ID1","moneda_id_target":"ID2","exchange_rate":7200,"fecha_inicio":"2024-01-01","activo":true}`
- `PUT /tipos-cambio/:id`
- `DELETE /tipos-cambio/:id`

### Referencias (/referencias)
- `GET /referencias`
- `GET /referencias/:id`
- `POST /referencias` → `{"nombre_referencia":"Redes Sociales"}`
- `PUT /referencias/:id`
- `DELETE /referencias/:id`

### Horarios (/horarios)
- `GET /horarios`
- `GET /horarios/:id`
- `POST /horarios` → `{"nombre_horario":"Mañana","hora_inicio":6,"hora_fin":12}` ⚠️ Números, no strings
- `PUT /horarios/:id`
- `DELETE /horarios/:id`

### Planes de Pago (/planes-pago)
- `GET /planes-pago`
- `GET /planes-pago/:id`
- `POST /planes-pago` → `{"nombre_plan_pago":"Mensual","importe_plan_pago":150000,"duracion_plan_pago":30,"moneda_id":"ID","activo":true}`
- `PUT /planes-pago/:id`
- `DELETE /planes-pago/:id`

### Cuentas (/cuentas)
- `GET /cuentas`
- `GET /cuentas/:id`
- `POST /cuentas` → `{"nombre_cuenta":"Caja","moneda_id":"ID"}`
- `PUT /cuentas/:id`
- `DELETE /cuentas/:id`

### Entrenadores (/entrenadores)
- `GET /entrenadores`
- `GET /entrenadores/:id`
- `POST /entrenadores` → Ver POSTMAN_GUIDE.md para payload completo
- `PUT /entrenadores/:id`
- `DELETE /entrenadores/:id`

### Clientes (/clientes)
- `GET /clientes`
- `GET /clientes/:ci`
- `POST /clientes` → Ver POSTMAN_GUIDE.md (requiere múltiples IDs)
- `PUT /clientes/:ci`
- `DELETE /clientes/:ci`

### Cliente Peso (/clientes-peso)
- `GET /clientes-peso`
- `GET /clientes-peso/:id`
- `POST /clientes-peso` → `{"ci":"123","fecha":"2024-01-01","peso":75.5}`
- `PUT /clientes-peso/:id`
- `DELETE /clientes-peso/:id`

### Asistencias (/asistencias)
- `GET /asistencias`
- `GET /asistencias/:id`
- `POST /asistencias` → `{"ci":"123"}`
- `DELETE /asistencias/:id`

### Pagos Cliente (/pagos-cliente)
- `GET /pagos-cliente`
- `GET /pagos-cliente/:id`
- `POST /pagos-cliente` → Ver POSTMAN_GUIDE.md
- `PUT /pagos-cliente/:id`
- `DELETE /pagos-cliente/:id`

### Detalles Pago (/detalles-pago)
- `GET /detalles-pago`
- `GET /detalles-pago/:id`
- `POST /detalles-pago` → Ver POSTMAN_GUIDE.md
- `PUT /detalles-pago/:id`
- `DELETE /detalles-pago/:id`

### Sincronización (/sync) - Requiere Device Token
- `POST /sync/upload-events` → `{"events":[...]}`
- `GET /sync/changes?since=2024-01-01T00:00:00.000Z`

## 📝 Headers Requeridos

### Para Admin Endpoints
```
Authorization: Bearer {{admin_token}}
Content-Type: application/json
```

### Para Device Endpoints (/sync)
```
Authorization: Bearer {{device_token}}
Content-Type: application/json
```

## ⚡ Orden de Creación Recomendado

1. Login Admin
2. Monedas
3. Nacionalidades
4. Tipos Pago
5. Referencias
6. Horarios
7. Planes Pago (necesita moneda)
8. Cuentas (necesita moneda)
9. Tipos Cambio (necesita 2 monedas)
10. Entrenadores
11. Clientes (necesita: nacionalidad, horario, plan, entrenador, referencia)
12. Cliente Peso (necesita cliente)
13. Asistencias (necesita cliente)
14. Pagos (necesita cliente, plan, etc.)

## 🐛 Errores Comunes

- **401**: Token faltante → Hacer login primero
- **403**: Token incorrecto → Admin token para CRUD, Device para /sync
- **400**: Payload inválido → Revisar campos requeridos
- **404**: No existe → Verificar ID

## 📦 Preparación Rápida

```bash
# 1. Ejecutar setup SQL
mysql -u root -p gym_db < scripts/setup-postman-data.sql

# 2. Iniciar servidor
bun src/infrastructure/http/server.ts

# 3. Abrir Postman y usar las rutas
```

Ver **POSTMAN_GUIDE.md** para guía completa con ejemplos detallados.
