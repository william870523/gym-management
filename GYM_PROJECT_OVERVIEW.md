# Gym Management - Proyecto Offline/Online (William)

## Objetivo general

Sistema para gestionar uno o varios gimnasios con:

- Backend REMOTO (`gym-remote-api`) con MariaDB.
- Backend LOCAL (`gym-local-api`) con SQLite.
- Frontend (Flutter Desktop/Web).
- Sincronizacion offline-first:
  - El gimnasio puede trabajar sin internet.
  - Cuando vuelve la conexion, se sincronizan datos locales y remotos.

## Arquitectura objetivo

Usar **arquitectura en capas / Clean Architecture**:

- `domain/`
  - Entidades de dominio.
  - Interfaces de repositorios.
  - Reglas de negocio puras (sin HTTP, sin DB).

- `application/`
  - Casos de uso (use cases).
  - Servicios de aplicacion.
  - Orquestan llamadas a repositorios, validaciones, etc.

- `infrastructure/`
  - Prisma (acceso a base de datos).
  - Implementaciones de repositorios.
  - HTTP (controladores, rutas).
  - Integraciones externas (logs, auth, etc).

- `config/`
  - Variables de entorno.
  - Logger.
  - Config general.

### Reglas importantes

1. **Los controladores HTTP no tienen logica de negocio.**  
   Solo:
   - Validan entrada con Zod.
   - Llaman a un caso de uso.
   - Devuelven respuesta.

2. **Zod esta integrado en todas las entradas externas**  
   - Para evitar inyecciones SQL y datos mal formados.
   - Cada endpoint debe tener su `schema` de request/response.

3. **Repositorios ocultan Prisma y SQL.**  
   - La capa de dominio no sabe nada de Prisma ni de la base de datos.

4. **Sincronizacion basada en eventos**  
   - Local y remoto hablan con eventos (`event_id`, `entidad`, `operacion`, `payload`).
   - Todos los eventos remotos se guardan en `sync_log`.

## Estado actual (remoto)

- Base de datos MariaDB (`gym`) con todas las tablas ya ajustadas:
  - Entidades globales: `monedas`, `nacionalidades`, `tipo_pago`, `tipo_cambio`, `referencia`.
  - Configuracion por gym: `horario`, `planes_pago`, `cuenta`, `entrenadores`.
  - Entidades principales: `cliente`, `cliente_peso`, `asistencia`, `pago_cliente`, `detalle_pago`.
  - Infraestructura/sync: `gym`, `device`, `sync_log`, `sync_client_state`.
  - Usuarios: `User`.

- `gym-remote-api` ya tiene:
  - Registro y login.
  - `POST /sync/upload-events` recibe eventos de clientes.
  - `GET /sync/changes` devuelve eventos desde `sync_log`.
  - `SyncService` con metodos:
    - `applyMonedaEvent`, `applyNacionalidadEvent`, `applyTipoPagoEvent`, `applyTipoCambioEvent`, `applyReferenciaEvent`.
    - `applyHorarioEvent`, `applyPlanesPagoEvent`, `applyCuentaEvent`, `applyEntrenadorEvent`.
    - `applyClientePesoEvent`, `applyAsistenciaEvent`, `applyPagoClienteEvent`, `applyDetallePagoEvent`.
  - Casos de uso en `application/`:
    - `ApplyClienteEventUseCase` para aplicar y registrar eventos de cliente (sincronizacion).

## Roadmap de arquitectura y refactor

### Fase 1 - Asegurar arquitectura en capas (remoto)

- [ ] Mover logica de negocio de controladores HTTP a casos de uso en `application/`.  
      Avance: evento de cliente en sync migrado a `ApplyClienteEventUseCase`.
- [ ] Definir casos de uso principales:
  - `CreateClienteUseCase`
  - `UpdateClienteUseCase`
  - `RegisterPagoUseCase`
  - `GetClientesByGymUseCase`
  - etc.
- [ ] Crear interfaces de repositorios en `domain/`:
  - `IClienteRepository`, `IPagoRepository`, etc.  
    Avance: `ClienteRepository` y `SyncLogRepository` listos.
- [ ] Crear implementaciones Prisma en `infrastructure/repositories`.  
      Avance: `PrismaClienteRepository` y `PrismaSyncLogRepository` implementados para sync de cliente.

### Fase 2 - Validaciones con Zod

- [ ] Definir esquemas Zod para:
  - Auth (login/register).
  - Sync (`UploadEventsDTO`, `ChangesQueryDTO`).
  - CRUD de entidades principales (cliente, pago, etc.).
- [ ] Integrar Zod en todos los controladores (req.body, req.query).

### Fase 3 - Pruebas unitarias e integracion

- [ ] Anadir framework de tests (por ejemplo, `vitest` o `jest` con Bun).
- [ ] Crear tests unitarios para:
  - Casos de uso (use cases).
  - Servicios de dominio.
- [ ] Crear tests de integracion para:
  - Controladores HTTP (incluyendo validaciones Zod).
  - Endpoints de sincronizacion (`/sync/upload-events`, `/sync/changes`).

### Fase 4 - Backend local (`gym-local-api`)

- [ ] Inicializar proyecto `gym-local-api` con Bun + Prisma (SQLite).
- [ ] Replicar modelos de negocio basicos en SQLite.
- [ ] Crear `sync_outbox` y `sync_state`.
- [ ] Implementar worker de sincronizacion:
  - Enviar eventos pendientes al remoto.
  - Recibir cambios del remoto y aplicarlos a SQLite.
- [ ] Exponer API local para el frontend (Flutter).


# CHECKLIST DEL PROYECTO – REMOTO + LOCAL + SYNC

## FASE 1 – SYNC REMOTA (COMPLETADO)
[x] DB MariaDB normalizada  
[x] Repositorios domain  
[x] Repositorios Prisma  
[x] Casos de uso ApplyXEventUseCase  
[x] UploadEventsUseCase  
[x] SyncService como infraestructura  
[x] Idempotencia con event_id  
[x] Logging estructurado  
[x] Validación Zod  
[x] Sync completo de todas las entidades  

## FASE 2 – CRUD REMOTO (ACTUAL)
[ ] Patrón CRUD para "nacionalidad"  
[ ] Replicar para todas las entidades  
[ ] Repos CRUD  
[ ] Zod DTOs  
[ ] Casos de uso Create/Update/Delete/Get/List  
[ ] Rutas REST completas  

## FASE 3 – SEGURIDAD / HTTPS
[ ] JWT por usuario  
[ ] JWT por device  
[ ] Roles / permisos  
[ ] Rate limiting por device  
[ ] Validación strict de gym_id  
[ ] NGINX + TLS 1.3  
[ ] Configuración de producción  

## FASE 4 – BACKEND LOCAL (SQLite)
[ ] Migration del schema completo a Prisma SQLite  
[ ] Repos locales  
[ ] sync_outbox  
[ ] sync_state  
[ ] Worker (pull/push)  
[ ] Glue con Flutter      

## FASE 5 – FRONTEND
[ ] CRUD visual  
[ ] Dashboards  
[ ] Monitoreo de sync  
[ ] Integración offline-first  
