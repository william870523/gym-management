-- ============================================
-- Script de Preparación para Pruebas en Postman
-- gym-remote-api
-- ============================================
-- EJECUTAR ESTE SCRIPT ANTES DE PROBAR EN POSTMAN
-- ============================================

USE gym_db;

-- 1. Crear usuario admin para autenticación
-- Password: admin123 (hash bcrypt)
INSERT INTO User (user_id, user_nombre, user_email, password, role, createdAt, is_deleted, created_at, updated_at, version)
VALUES (
  'admin-user-id',
  'Administrador',
  'admin@test.com',
  '$2a$10$rOqK9vN8K8qF7x.YR7C4w.V9UJxqKZE6HZHzKFJxKFJxKFJxKFJxK',
  'admin',
  NOW(),
  FALSE,
  NOW(),
  NOW(),
  1
)
ON DUPLICATE KEY UPDATE
  password = '$2a$10$rOqK9vN8K8qF7x.YR7C4w.V9UJxqKZE6HZHzKFJxKFJxKFJxKFJxK',
  role = 'admin';

-- 2. Crear gimnasio de prueba
INSERT INTO gym (gym_id, codigo, nombre,activo, created_at, updated_at)
VALUES ('gym-1', 'GYM001', 'Gimnasio Principal', TRUE, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  codigo = 'GYM001',
  nombre = 'Gimnasio Principal',
  activo = TRUE;

-- 3. Crear dispositivo de prueba con secret_key
INSERT INTO device (
  device_id,
  gym_id,
  nombre,
  tipo,
  descripcion,
  secret_key,
  is_active,
  -- activo, -- Removed
  created_at,
  updated_at
)
VALUES (
  'test-device-id',
  'gym-1',
  'Dispositivo de Prueba Postman',
  'BACKEND_OFFLINE',
  'Dispositivo para testing con Postman',
  'secret123',
  TRUE,
  -- TRUE, -- Removed
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  secret_key = 'secret123',
  is_active = TRUE;
  -- activo = TRUE; -- Removed

-- ============================================
-- VERIFICACIÓN
-- ============================================

SELECT '✅ Usuario Admin creado:' AS Status;
SELECT user_id, user_email, role FROM User WHERE user_email = 'admin@test.com';

SELECT '✅ Gimnasio creado:' AS Status;
SELECT gym_id, codigo, nombre FROM gym WHERE gym_id = 'gym-1';

SELECT '✅ Dispositivo creado:' AS Status;
SELECT device_id, nombre, secret_key, is_active FROM device WHERE device_id = 'test-device-id';

-- ============================================
-- DATOS DE PRUEBA OPCIONALES
-- ============================================

-- Monedas de ejemplo
INSERT INTO Moneda (moneda_id, moneda_nombre, codigo, simbolo, created_at, updated_at, is_deleted, version)
VALUES
  ('moneda-usd', 'Dólar Estadounidense', 'USD', '$', NOW(), NOW(), FALSE, 1),
  ('moneda-gs', 'Guaraní Paraguayo', 'PYG', '₲', NOW(), NOW(), FALSE, 1)
ON DUPLICATE KEY UPDATE
  moneda_nombre = VALUES(moneda_nombre),
  codigo = VALUES(codigo),
  simbolo = VALUES(simbolo);

-- Nacionalidades de ejemplo
INSERT INTO Nacionalidad (nacionalidad_id, nacionalidad_nombre, codigo_iso, created_at, updated_at, is_deleted, version)
VALUES
  ('nac-py', 'Paraguaya', 'PRY', NOW(), NOW(), FALSE, 1),
  ('nac-br', 'Brasileña', 'BRA', NOW(), NOW(), FALSE, 1),
  ('nac-ar', 'Argentina', 'ARG', NOW(), NOW(), FALSE, 1)
ON DUPLICATE KEY UPDATE
  nacionalidad_nombre = VALUES(nacionalidad_nombre),
  codigo_iso = VALUES(codigo_iso);

-- Tipos de Pago de ejemplo
INSERT INTO tipo_pago (tipo_pago_id, nombre_tipo_pago, created_at, updated_at, is_deleted, version)
VALUES
  ('tp-efectivo', 'Efectivo', NOW(), NOW(), FALSE, 1),
  ('tp-tarjeta', 'Tarjeta de Crédito', NOW(), NOW(), FALSE, 1),
  ('tp-transferencia', 'Transferencia Bancaria', NOW(), NOW(), FALSE, 1)
ON DUPLICATE KEY UPDATE
  nombre_tipo_pago = VALUES(nombre_tipo_pago);

-- Referencias de ejemplo
INSERT INTO Referencia (referencia_id, nombre_referencia, created_at, updated_at, is_deleted, version)
VALUES
  ('ref-amigo', 'Recomendación de Amigo', NOW(), NOW(), FALSE, 1),
  ('ref-redes', 'Redes Sociales', NOW(), NOW(), FALSE, 1),
  ('ref-google', 'Búsqueda en Google', NOW(), NOW(), FALSE, 1)
ON DUPLICATE KEY UPDATE
  nombre_referencia = VALUES(nombre_referencia);

-- Horarios de ejemplo
INSERT INTO horario (horario_id, nombre_horario, hora_inicio, hora_fin, created_at, updated_at, is_deleted, version)
VALUES
  ('hor-manana', 'Mañana', 6, 12, NOW(), NOW(), FALSE, 1),
  ('hor-tarde', 'Tarde', 14, 20, NOW(), NOW(), FALSE, 1),
  ('hor-noche', 'Noche', 18, 22, NOW(), NOW(), FALSE, 1)
ON DUPLICATE KEY UPDATE
  nombre_horario = VALUES(nombre_horario),
  hora_inicio = VALUES(hora_inicio),
  hora_fin = VALUES(hora_fin);

-- Planes de Pago de ejemplo
INSERT INTO planes_pago (
  planes_pago_id,
  nombre_plan_pago,
  importe_plan_pago,
  duracion_plan_pago,
  moneda_id,
  activo,
  created_at,
  updated_at,
  is_deleted,
  version
)
VALUES
  ('plan-mensual', 'Plan Mensual', 150000, 30, 'moneda-gs', TRUE, NOW(), NOW(), FALSE, 1),
  ('plan-trimestral', 'Plan Trimestral', 400000, 90, 'moneda-gs', TRUE, NOW(), NOW(), FALSE, 1),
  ('plan-anual', 'Plan Anual', 1500000, 365, 'moneda-gs', TRUE, NOW(), NOW(), FALSE, 1)
ON DUPLICATE KEY UPDATE
  nombre_plan_pago = VALUES(nombre_plan_pago),
  importe_plan_pago = VALUES(importe_plan_pago),
  duracion_plan_pago = VALUES(duracion_plan_pago);

-- Cuentas de ejemplo
INSERT INTO Cuenta (cuenta_id, nombre_cuenta, moneda_id, created_at, updated_at, is_deleted, version)
VALUES
  ('cuenta-caja', 'Caja Principal', 'moneda-gs', NOW(), NOW(), FALSE, 1),
  ('cuenta-banco', 'Cuenta Bancaria', 'moneda-gs', NOW(), NOW(), FALSE, 1)
ON DUPLICATE KEY UPDATE
  nombre_cuenta = VALUES(nombre_cuenta);

-- Tipo de Cambio de ejemplo
INSERT INTO tipo_cambio (
  tipo_cambio_id,
  moneda_id_base,
  moneda_id_target,
  exchange_rate,
  fecha_inicio,
  activo,
  created_at,
  updated_at,
  is_deleted,
  version
)
VALUES (
  'tc-usd-gs',
  'moneda-usd',
  'moneda-gs',
  7200.00,
  NOW(),
  TRUE,
  NOW(),
  NOW(),
  FALSE,
  1
)
ON DUPLICATE KEY UPDATE
  exchange_rate = 7200.00,
  activo = TRUE;

SELECT '✅ Datos de ejemplo creados' AS Status;

-- ============================================
-- RESUMEN DE CREDENCIALES PARA POSTMAN
-- ============================================

SELECT '
=====================================
 CREDENCIALES PARA POSTMAN
=====================================

 ADMIN LOGIN:
 Email: admin@test.com
 Password: admin123

 DEVICE LOGIN:
 Device ID: test-device-id
 Secret: secret123

 BASE URL:
 http://localhost:3001

=====================================
 IDs ÚTILES PARA TESTS
=====================================
' AS Credenciales;

SELECT 'Monedas:' AS Categoria, moneda_id AS ID, moneda_nombre AS Nombre FROM Moneda WHERE is_deleted = FALSE;
SELECT 'Nacionalidades:' AS Categoria, nacionalidad_id AS ID, nacionalidad_nombre AS Nombre FROM Nacionalidad WHERE is_deleted = FALSE;
SELECT 'Tipos de Pago:' AS Categoria, tipo_pago_id AS ID, nombre_tipo_pago AS Nombre FROM tipo_pago WHERE is_deleted = FALSE;
SELECT 'Referencias:' AS Categoria, referencia_id AS ID, nombre_referencia AS Nombre FROM Referencia WHERE is_deleted = FALSE;
SELECT 'Horarios:' AS Categoria, horario_id AS ID, nombre_horario AS Nombre FROM horario WHERE is_deleted = FALSE;
SELECT 'Planes de Pago:' AS Categoria, planes_pago_id AS ID, nombre_plan_pago AS Nombre FROM planes_pago WHERE is_deleted = FALSE;
SELECT 'Cuentas:' AS Categoria, cuenta_id AS ID, nombre_cuenta AS Nombre FROM Cuenta WHERE is_deleted = FALSE;

-- ============================================
-- LISTO PARA PROBAR EN POSTMAN
-- ============================================
