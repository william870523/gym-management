import { randomUUID } from "crypto";
import type { UpdateClienteDTO } from "../../dtos/ClienteDTO";
import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { resolverFechaNacimiento } from "../../clients/client-birthdate";
import { fechaNegocioDeSede } from "../../clients/business-date";
import {
    decidirCambioCategoria,
    mensajeCambioCategoria,
    CategoriaCambioError,
    type CategoriaCliente,
} from "../../../domain/cliente-categoria-policy";
import { exigirFlujoFormal } from "../../../domain/cliente-condiciones-contractuales";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { quitarProyeccionesDeCliente } from "../sync/sync-event-contract";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class UpdateClienteUseCase {
    constructor(
        private readonly clienteRepository: ClienteRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(
        id: string,
        dto: UpdateClienteDTO,
        gymId: string,
        actor?: { userId: string | null; nombre?: string | null; role?: string | null },
    ): Promise<void> {
        // La ficha, su evento y el aviso de categoría, en la MISMA transacción.
        // Sueltos, un fallo entre medias dejaba al socio editado sin evento que
        // lo anunciara —el escritorio no se enteraba nunca— o con el aviso
        // escrito y sin su fila de sync, que es la mitad inversa del mismo daño.
        return this.enTransaccion(async (tx) => {
        const clienteRepo = this.clienteRepository.withTransaction(tx);
        const existing = await clienteRepo.findById(id, gymId);
        if (!existing) {
            throw new Error("Cliente not found");
        }

        // Las condiciones del contrato no se cambian editando la ficha. El
        // entrenador, el plan y las fechas de cobertura mueven comisiones,
        // precios y acceso, y cada uno tiene su flujo formal. La regla compara
        // contra lo almacenado porque el formulario reenvía el modelo entero:
        // sin eso, guardar un teléfono fallaría por un plan que nadie tocó.
        exigirFlujoFormal({
            entrante: dto as unknown as Record<string, unknown>,
            almacenado: existing as unknown as Record<string, unknown>,
        });

        // R5.3 — cambiar la categoría de un socio ya registrado es de
        // administración y exige motivo: mueve el precio de todos sus cobros
        // futuros. El alta sí la elige recepción. La regla vive en el dominio y
        // es gemela de la del escritorio.
        const decision = decidirCambioCategoria({
            categoriaActual: existing.categoria ?? null,
            categoriaEntrante: dto.categoria,
            rol: actor?.role ?? null,
            motivo: (dto as any).motivo_categoria ?? null,
        });
        if (!decision.permitido) {
            throw new CategoriaCambioError(decision.error, decision.status);
        }

        const now = trustedClock.nowUtc();
        const updateData: Partial<Cliente> = {
            ...dto,
            // Un null explícito vacía la foto; una cadena vacía es «no adjuntó
            // archivo» y no toca nada. Antes ambas se volvían `undefined`, así
            // que desde la web no había forma de quitar una foto equivocada.
            foto_cliente:
                dto.foto_cliente === undefined || dto.foto_cliente === ""
                    ? undefined
                    : dto.foto_cliente === null
                        ? null
                        : Buffer.from(dto.foto_cliente, 'base64'),
            fecha_inicio: dto.fecha_inicio ? new Date(dto.fecha_inicio) : undefined,
            fecha_fin: dto.fecha_fin ? new Date(dto.fecha_fin) : undefined,
            // E0 (§7-bis): el tipo efectivo es el que quede tras el cambio, y la
            // clave documental no se edita, así que el CI es el almacenado. Al
            // editar no se exige: un cambio de teléfono no puede quedar
            // bloqueado por un dato ajeno.
            fecha_nacimiento: resolverFechaNacimiento({
                tipoDocumento: dto.tipo_documento ?? existing.tipo_documento,
                ci: existing.ci,
                fechaNacimientoEntrante: dto.fecha_nacimiento,
                fechaNacimientoActual: existing.fecha_nacimiento ?? null,
                fechaNegocio: await fechaNegocioDeSede(gymId, now),
                esAlta: false,
            }),
            // R5.3 — sin esta línea, editar a VIEJO desde la web respondía 200
            // y dejaba la categoría como estaba. Solo se toca si viene.
            ...(dto.categoria === undefined ? {} : { categoria: dto.categoria }),
            updated_at: now,
            version: (existing.version ?? 0) + 1
        };

        await clienteRepo.update(id, gymId, updateData);

        const updated = await clienteRepo.findById(id, gymId);
        if (updated) {
            const nationalityCode = await clienteRepo.findNationalityCode(
                updated.nacionalidad_id,
            );
            if (!nationalityCode) {
                throw new Error("La nacionalidad del cliente no está disponible.");
            }
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cliente",
                operacion: "UPDATE",
                entidadId: id,
                gymId: updated.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                // `findById` devuelve la ficha CON la proyección de membresía
                // encima, que no son columnas de `cliente`. Enviarlas tal cual
                // hacía que el escritorio rechazara el evento y lo apartara en
                // cuarentena: la edición hecha en la web no llegaba nunca.
                payload: quitarProyeccionesDeCliente({
                    ...updated,
                    nacionalidad_codigo_iso: nationalityCode,
                    foto_cliente: updated.foto_cliente ? Buffer.from(updated.foto_cliente).toString('base64') : null
                }) as any
            }, tx);
        }

        // R5.3 — el cambio de categoría deja rastro donde administración ya
        // mira: la bandeja de avisos. Se reutiliza `aviso_administracion` en
        // vez de inventar una tabla porque ya cruza en los dos sentidos y ya
        // tiene sitio en la vista; una entidad nueva habría que darla de alta
        // en el contrato de sync, que es donde vive la trampa de la Unidad 10.
        if (decision.permitido && decision.huboCambio) {
            const desde = (String(existing.categoria ?? "NUEVO").toUpperCase() ||
                "NUEVO") as CategoriaCliente;
            const hasta = String(dto.categoria).toUpperCase() as CategoriaCliente;
            // El nombre no viaja en el token; se resuelve aquí y solo cuando de
            // verdad hubo cambio. Un aviso que dice «lo hizo alguien» no sirve
            // para lo que existe la bandeja.
            const autor = actor?.userId
                ? await tx.user.findUnique({
                      where: { user_id: actor.userId },
                      select: { user_nombre: true },
                  })
                : null;
            const avisoId = randomUUID();
            const aviso = await tx.avisoAdministracion.create({
                data: {
                    aviso_id: avisoId,
                    gym_id: gymId,
                    tipo: "CAMBIO_CATEGORIA",
                    referencia_id: id,
                    mensaje: mensajeCambioCategoria({
                        ci: id,
                        nombre: `${existing.nombres} ${existing.apellidos}`.trim(),
                        desde,
                        hasta,
                        motivo: decision.motivo,
                    }),
                    actor_user_id: actor?.userId ?? null,
                    actor_nombre: autor?.user_nombre ?? actor?.nombre ?? null,
                    leido: false,
                    is_deleted: false,
                    created_at: now,
                    source_device: "WEB_ADMIN",
                    version: 1,
                    updated_at: now,
                    deleted_at: null,
                },
            });
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "aviso_administracion",
                operacion: "INSERT",
                entidadId: avisoId,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: aviso as any,
            }, tx);
        }
        });
    }
}

