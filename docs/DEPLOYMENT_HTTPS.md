# Guía de Despliegue HTTPS - gym-remote-api

## Arquitectura de Despliegue

```
┌─────────────┐
│   Cliente   │
│ (Flutter,   │
│  Browser,   │
│  Backend)   │
└──────┬──────┘
       │ HTTPS (443)
       │ TLS 1.3
       ▼
┌──────────────────┐
│    Internet      │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Nginx/Caddy     │
│  Reverse Proxy   │
│  - Port 443      │
│  - TLS Term.     │
│  - HSTS          │
└──────┬───────────┘
       │ HTTP (localhost)
       │ Port 8080
       ▼
┌──────────────────┐
│   Bun/Hono API   │
│   gym-remote-api │
│   127.0.0.1:8080 │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│   MariaDB        │
│   Database       │
└──────────────────┘
```

## Variables de Entorno Requeridas

Crear archivo `.env` en el directorio raíz del proyecto:

```env
# Configuración del Servidor
NODE_ENV=production
PORT=8080

# Base de Datos
DATABASE_URL="mysql://user:password@localhost:3306/gym_db"

# Seguridad JWT
JWT_SECRET=your-super-secure-random-string-change-this
JWT_EXPIRES_IN=12h

# Logging (opcional)
LOG_LEVEL=info
```

**⚠️ IMPORTANTE:** Cambiar `JWT_SECRET` por una cadena aleatoria segura (mínimo 32 caracteres).

## Prerequisitos del Servidor

### Sistema Operativo
- Ubuntu 22.04 LTS (recomendado)
- Debian 11+
- CentOS 8+

### Software Requerido
- **Bun** v1.x+
- **MariaDB** 10.6+
- **Nginx** 1.18+
- **Certbot** (para Let's Encrypt)

## Guía de Instalación Paso a Paso

### 1. Preparar el Servidor

```bash
# Actualizar el sistema
sudo apt update && sudo apt upgrade -y

# Instalar dependencias
sudo apt install -y curl git build-essential
```

### 2. Instalar Bun

```bash
# Instalar Bun
curl -fsSL https://bun.sh/install | bash

# Verificar instalación
bun --version
```

### 3. Instalar y Configurar MariaDB

```bash
# Instalar MariaDB
sudo apt install -y mariadb-server

# Asegurar la instalación
sudo mysql_secure_installation

# Crear base de datos y usuario
sudo mysql -u root -p << EOF
CREATE DATABASE gym_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'gym_user'@'localhost' IDENTIFIED BY 'secure_password_here';
GRANT ALL PRIVILEGES ON gym_db.* TO 'gym_user'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 4. Clonar y Configurar la Aplicación

```bash
# Crear directorio para la aplicación
sudo mkdir -p /var/www/gym-remote-api
sudo chown $USER:$USER /var/www/gym-remote-api

# Clonar el repositorio
cd /var/www/gym-remote-api
git clone <repo-url> .

# Instalar dependencias
bun install

# Configurar variables de entorno
cp .env.example .env
nano .env
# Editar con los valores correctos

# Ejecutar migraciones de Prisma
bunx prisma migrate deploy
bunx prisma generate
```

### 5. Instalar y Configurar Nginx

```bash
# Instalar Nginx
sudo apt install -y nginx

# Verificar instalación
nginx -v
```

Copiar la configuración de ejemplo (ver `infra/deploy/nginx-gym.conf`):

```bash
# Copiar configuración
sudo cp infra/deploy/nginx-gym.conf /etc/nginx/sites-available/gym-api

# Editar y personalizar
sudo nano /etc/nginx/sites-available/gym-api
# Cambiar: server_name api.ejemplo.com;
# Cambiar: upstream backend si es necesario

# Habilitar el sitio
sudo ln -s /etc/nginx/sites-available/gym-api /etc/nginx/sites-enabled/

# Probar configuración
sudo nginx -t

# No recargar todavía (primero obtener certificado SSL)
```

### 6. Obtener Certificado SSL con Let's Encrypt

```bash
# Instalar Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtener certificado (método automático con Nginx)
sudo certbot --nginx -d api.ejemplo.com

# Certbot preguntará:
# 1. Email para notificaciones
# 2. Aceptar términos de servicio
# 3. Redirección HTTP a HTTPS (seleccionar: Yes)

# Verificar renovación automática
sudo certbot renew --dry-run
```

El certificado se renovará automáticamente via cron (`/etc/cron.d/certbot`).

### 7. Configurar Servicio Systemd para Bun

Crear archivo de servicio:

```bash
sudo nano /etc/systemd/system/gym-api.service
```

Contenido:

```ini
[Unit]
Description=Gym Remote API - Bun/Hono Server
After=network.target mariadb.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/gym-remote-api
Environment="NODE_ENV=production"
Environment="PORT=8080"
EnvironmentFile=/var/www/gym-remote-api/.env
ExecStart=/home/YOUR_USER/.bun/bin/bun src/infrastructure/http/server.ts
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gym-api

[Install]
WantedBy=multi-user.target
```

**Ajustar:**
- `User=www-data` (o el usuario apropiado)
- `ExecStart` con la ruta correcta a Bun

Activar el servicio:

```bash
# Recargar systemd
sudo systemctl daemon-reload

# Habilitar inicio automático
sudo systemctl enable gym-api

# Iniciar servicio
sudo systemctl start gym-api

# Verificar estado
sudo systemctl status gym-api

# Ver logs
sudo journalctl -u gym-api -f
```

### 8. Configuración Final de Nginx

Después de obtener el certificado SSL, actualizar la configuración:

```bash
# Editar configuración
sudo nano /etc/nginx/sites-available/gym-api

# Descomentar/verificar bloques SSL
# Asegurarse de que las rutas de certificados sean correctas

# Probar configuración
sudo nginx -t

# Recargar Nginx
sudo systemctl reload nginx
```

### 9. Configurar Firewall

```bash
# Permitir SSH
sudo ufw allow OpenSSH

# Permitir HTTP y HTTPS
sudo ufw allow 'Nginx Full'

# Habilitar firewall
sudo ufw enable

# Verificar estado
sudo ufw status
```

## Verificación del Despliegue

### 1. Probar HTTP → HTTPS Redirect

```bash
curl -I http://api.ejemplo.com
# Debe retornar 301/302 redirigiendo a https://
```

### 2. Probar HTTPS

```bash
curl -I https://api.ejemplo.com/health
# Debe retornar 200 OK
```

### 3. Verificar Headers de Seguridad

```bash
curl -I https://api.ejemplo.com/health | grep -i "strict-transport-security"
# Debe mostrar: Strict-Transport-Security: max-age=31536000
```

### 4. Probar Autenticación

```bash
# Login de usuario
curl -X POST https://api.ejemplo.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"admin123"}'

# Debe retornar token JWT
```

## Mejores Prácticas de Seguridad

### 1. Configuración de Red

**✅ Bind de API solo a localhost:**
```typescript
// En server.ts, el API debe escuchar solo en localhost
export default {
  port: env.port,
  hostname: "127.0.0.1", // Solo localhost
  fetch: app.fetch
};
```

**✅ MariaDB solo en localhost:**
```ini
# En /etc/mysql/mariadb.conf.d/50-server.cnf
bind-address = 127.0.0.1
```

### 2. Nginx Security Headers

La configuración de ejemplo ya incluye:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (HSTS)

### 3. Rate Limiting en Nginx

Agregar a la configuración de Nginx:

```nginx
# Definir zona de rate limiting (al inicio del archivo)
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/m;

# En location /
location / {
    limit_req zone=api_limit burst=20 nodelay;
    # ... resto de configuración
}

# En location /auth
location /auth {
    limit_req zone=auth_limit burst=5 nodelay;
    # ... resto de configuración
}
```

Esto limita:
- API general: 10 requests/segundo (burst hasta 20)
- Endpoints de auth: 5 requests/minuto (burst hasta 5)

### 4. Tamaño Máximo de Request

```nginx
# En bloque http o server
client_max_body_size 10M;
```

### 5. Timeouts

```nginx
# Timeouts para el proxy
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
```

### 6. Fail2ban (Opcional pero Recomendado)

```bash
# Instalar Fail2ban
sudo apt install -y fail2ban

# Crear filtro para Nginx
sudo nano /etc/fail2ban/filter.d/nginx-gym.conf
```

Contenido:

```ini
[Definition]
failregex = ^<HOST> .* "(GET|POST|HEAD).*" (401|403) .*$
ignoreregex =
```

Configurar jail:

```bash
sudo nano /etc/fail2ban/jail.local
```

```ini
[nginx-gym]
enabled = true
port = http,https
filter = nginx-gym
logpath = /var/log/nginx/access.log
maxretry = 5
bantime = 3600
```

Reiniciar Fail2ban:

```bash
sudo systemctl restart fail2ban
```

### 7. Actualizaciones del Sistema

```bash
# Configurar actualizaciones automáticas de seguridad
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 8. Backups de Base de Datos

Crear script de backup:

```bash
sudo nano /usr/local/bin/backup-gym-db.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/gym-db"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="gym_db"
DB_USER="gym_user"
DB_PASS="secure_password_here"

mkdir -p $BACKUP_DIR
mysqldump -u$DB_USER -p$DB_PASS $DB_NAME | gzip > $BACKUP_DIR/gym_db_$DATE.sql.gz

# Mantener solo últimos 7 días
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

```bash
sudo chmod +x /usr/local/bin/backup-gym-db.sh

# Agregar a crontab (diario a las 2 AM)
sudo crontab -e
# Agregar: 0 2 * * * /usr/local/bin/backup-gym-db.sh
```

## Monitoreo y Logs

### Logs de Aplicación

```bash
# Ver logs en tiempo real
sudo journalctl -u gym-api -f

# Ver errores
sudo journalctl -u gym-api -p err

# Ver desde hace 1 hora
sudo journalctl -u gym-api --since "1 hour ago"
```

### Logs de Nginx

```bash
# Access log
sudo tail -f /var/log/nginx/access.log

# Error log
sudo tail -f /var/log/nginx/error.log
```

### Logs de MariaDB

```bash
# Error log
sudo tail -f /var/log/mysql/error.log
```

## Troubleshooting

### API no responde

```bash
# Verificar que el servicio esté corriendo
sudo systemctl status gym-api

# Verificar que esté escuchando en el puerto
sudo netstat -tlnp | grep 8080

# Ver logs de error
sudo journalctl -u gym-api -n 100 --no-pager
```

### Nginx 502 Bad Gateway

```bash
# Verificar que backend esté corriendo
curl http://127.0.0.1:8080/health

# Verificar logs de Nginx
sudo tail -f /var/log/nginx/error.log
```

### Problemas con SSL

```bash
# Probar conexión SSL
openssl s_client -connect api.ejemplo.com:443 -servername api.ejemplo.com

# Verificar certificados
sudo certbot certificates

# Renovar manualmente
sudo certbot renew
```

## Actualizaciones de la Aplicación

```bash
cd /var/www/gym-remote-api

# Detener servicio
sudo systemctl stop gym-api

# Actualizar código
git pull origin main

# Instalar dependencias
bun install

# Ejecutar migraciones si hay
bunx prisma migrate deploy
bunx prisma generate

# Reiniciar servicio
sudo systemctl start gym-api

# Verificar
sudo systemctl status gym-api
```

## Checklist de Seguridad Post-Despliegue

- [ ] API escucha solo en localhost (127.0.0.1)
- [ ] MariaDB escucha solo en localhost
- [ ] Certificado SSL válido y funcionando
- [ ] HSTS habilitado
- [ ] HTTP redirige a HTTPS
- [ ] Headers de seguridad configurados
- [ ] Rate limiting activo
- [ ] Fail2ban configurado (opcional)
- [ ] Firewall (ufw) activo
- [ ] Backups automáticos configurados
- [ ] Actualizaciones automáticas habilitadas
- [ ] JWT_SECRET es único y seguro
- [ ] Credenciales de DB son seguras
- [ ] `server_tokens off` en Nginx
- [ ] Logs siendo monitoreados

## Soporte y Mantenimiento

### Contactos de Emergencia
- DevOps: [contacto]
- DBA: [contacto]

### Documentación Adicional
- [Prisma Migrations](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Nginx Security](https://nginx.org/en/docs/http/configuring_https_servers.html)
- [Let's Encrypt](https://letsencrypt.org/docs/)
- [Bun Runtime](https://bun.sh/docs)
