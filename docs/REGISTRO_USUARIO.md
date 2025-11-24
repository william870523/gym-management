# 🚀 GUÍA RÁPIDA: Registrar Usuario en Postman

## Endpoint de Registro

```http
POST http://localhost:3001/auth/register
```

## Headers
```
Content-Type: application/json
```

## Body (JSON)

### Para crear un usuario ADMIN:
```json
{
  "user_nombre": "Administrador Principal",
  "user_email": "admin@migimnasio.com",
  "password": "MiPassword123!",
  "role": "admin"
}
```

### Para crear un usuario NORMAL:
```json
{
  "user_nombre": "Usuario Normal",
  "user_email": "usuario@migimnasio.com",
  "password": "Password123!",
  "role": "user"
}
```

### Si omites el role (por defecto será "user"):
```json
{
  "user_nombre": "Juan Pérez",
  "user_email": "juan@email.com",
  "password": "password123"
}
```

## Respuesta Exitosa (201)

```json
{
  "ok": true,
  "message": "Usuario registrado exitosamente",
  "user_id": "abc123-uuid-generado",
  "email": "admin@migimnasio.com",
  "role": "admin"
}
```

## Errores Comunes

### 400 - Password muy corto
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

### 400 - Email inválido
```json
{
  "error": "Datos inválidos",
  "details": [
    {
      "path": ["user_email"],
      "message": "Email inválido"
    }
  ]
}
```

### 409 - Email ya existe
```json
{
  "error": "El email ya está registrado"
}
```

## Flujo Completo en Postman

### 1. Registrar Usuario
```http
POST http://localhost:3001/auth/register

{
  "user_nombre": "Admin Test",
  "user_email": "test@gym.com",
  "password": "admin123",
  "role": "admin"
}
```

### 2. Hacer Login con el usuario recién creado
```http
POST http://localhost:3001/auth/login

{
  "email": "test@gym.com",
  "password": "admin123"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user_id": "...",
  "role": "admin"
}
```

### 3. Usar el token para acceder a endpoints protegidos
```http
GET http://localhost:3001/monedas
Authorization: Bearer <token-del-paso-2>
```

## Validaciones

✅ **user_nombre**: Requerido, no puede estar vacío  
✅ **user_email**: Requerido, debe ser email válido, debe ser único  
✅ **password**: Requerido, mínimo 6 caracteres  
✅ **role**: Opcional, valores válidos: "admin" o "user" (default: "user")

## Notas Importantes

- ⚠️ El email debe ser único, no se pueden registrar dos usuarios con el mismo email
- 🔐 El password se hashea automáticamente con bcrypt antes de guardarse
- 👤 El user_id se genera automáticamente (UUID v4)
- 🎯 Usa role="admin" para acceder a todos los endpoints CRUD
- 📱 Usa role="user" para usuarios con permisos limitados

## Ejemplo Completo en Postman

1. **Abrir Postman**
2. **Crear nuevo request**:
   - Método: `POST`
   - URL: `http://localhost:3001/auth/register`
3. **Headers**:
   - Click en "Headers"
   - Add: `Content-Type`: `application/json`
4. **Body**:
   - Click en "Body"
   - Seleccionar "raw"
   - Seleccionar "JSON" del dropdown
   - Pegar:
     ```json
     {
       "user_nombre": "Mi Nombre",
       "user_email": "mi@email.com",
       "password": "password123",
       "role": "admin"
     }
     ```
5. **Click "Send"**
6. **Verificar respuesta 201** ✅

¡Listo! Ahora puedes hacer login con ese email y password.
