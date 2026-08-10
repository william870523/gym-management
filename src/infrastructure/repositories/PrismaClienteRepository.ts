import type { Cliente } from "../../domain/entities/Cliente";
import type { ClienteRepository } from "../../domain/repositories/ClienteRepository";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import type { ClienteCreationResult } from "../../domain/repositories/ClienteRepository";
import { trustedClock } from "../../config/trusted-clock";
import { randomUUID } from "crypto";
import {
  softDeleteGymScopedSyncRecord,
  upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";
import { assertGymScopedReference } from "./gym-scoped-reference";
import { datePartsInZone, nowUtc } from "../../config/tz";
import {
  fechaNegocioDesdePartes,
  resolveMembershipVigencia,
} from "../../domain/membership-vigencia";

/** Proyección de vigencia que acompaña a la membresía en cada payload. */
const proyectarVigencia = (
  membership: { estado: string; fecha_fin: Date } | null | undefined,
  fechaNegocio: Date,
) => {
  // `estado` dice qué acto ocurrió; la vigencia se deriva de la cobertura.
  // Ningún camino de la aplicación escribe VENCIDA, así que una ACTIVA
  // seguiría diciendo que cubre (docs/DEMO_MEMBERSHIP_VIGENCIA.md).
  const resultado = resolveMembershipVigencia({
    estado: membership?.estado,
    fechaFin: membership?.fecha_fin,
    fechaNegocio,
  });
  return {
    membresia_vigencia: resultado.vigencia,
    membresia_dias_desde_vencimiento: resultado.diasDesdeVencimiento,
    membresia_cubre_hoy: resultado.cubreHoy,
  };
};

export class PrismaClienteRepository implements ClienteRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  /**
   * Fecha de negocio de ESA sede. Cada gimnasio de la cadena puede tener su
   * zona, así que no se puede resolver con una constante del proceso
   * (docs/TIME_CONTRACT.md).
   */
  private async fechaNegocio(gymId: string) {
    const gym = await this.client.gym.findUnique({
      where: { gym_id: gymId },
      select: { timezone: true },
    });
    return fechaNegocioDesdePartes(
      datePartsInZone(gym?.timezone?.trim() || "Etc/UTC", nowUtc()),
    );
  }

  withTransaction(tx: SyncTransactionContext): PrismaClienteRepository {
    return new PrismaClienteRepository(tx);
  }

  // Unidad 01: usa una transacción propia cuando `client` es el prisma raíz;
  // si ya es el cliente de una transacción (upload), la reutiliza en vez de
  // anidar otra —Prisma no soporta transacciones anidadas y un TransactionClient
  // no expone `$transaction`.
  private runInClient<T>(work: (c: any) => Promise<T>): Promise<T> {
    return typeof this.client.$transaction === "function"
      ? this.client.$transaction(work)
      : work(this.client);
  }

  // Guarda o actualiza un cliente a partir de un evento de sincronizacion.
  async upsertFromSync(payload: Cliente): Promise<void> {
    const now = trustedClock.nowUtc();
    if (!payload.gym_id) throw new Error("El evento de cliente no tiene gimnasio autenticado.");
    await this.runInClient(async (tx) => {
      await Promise.all([
        payload.id_planes_pago
          ? assertGymScopedReference({
              delegate: tx.planesPago,
              entity: "plan",
              pk: "id_planes_pago",
              id: payload.id_planes_pago,
              gymId: payload.gym_id!,
            })
          : Promise.resolve(),
        payload.id_entrenador
          ? assertGymScopedReference({
              delegate: tx.entrenador,
              entity: "entrenador",
              pk: "id_entrenador",
              id: payload.id_entrenador,
              gymId: payload.gym_id!,
            })
          : Promise.resolve(),
        payload.id_horarios
          ? assertGymScopedReference({
              delegate: tx.horario,
              entity: "horario",
              pk: "horario_id",
              id: payload.id_horarios,
              gymId: payload.gym_id!,
            })
          : Promise.resolve(),
      ]);
      await upsertGymScopedSyncRecord({
      delegate: tx.cliente,
      entity: "cliente",
      pk: "ci",
      id: payload.ci,
      gymId: payload.gym_id,
      create: {
        ci: payload.ci,
        tipo_documento: payload.tipo_documento,
        // E0 (§7-bis) y R5.3. Ambas viajaban en el evento y se perdían aquí:
        // el escritorio derivaba la fecha del CI y clasificaba VIEJO, y la web
        // enseñaba a todo el mundo sin fecha y como NUEVO. Un campo que el
        // handler mapea pero el upsert no escribe es una divergencia silenciosa.
        fecha_nacimiento: payload.fecha_nacimiento ?? null,
        categoria: payload.categoria ?? "NUEVO",
        nombres: payload.nombres,
        apellidos: payload.apellidos,
        sexo: payload.sexo,
        foto_cliente: payload.foto_cliente ? Buffer.from(payload.foto_cliente) : null,
        cliente_peso_id: payload.cliente_peso_id,
        estatura_cliente: payload.estatura_cliente,
        direccion: payload.direccion ?? null,
        telefono: payload.telefono ?? null,
        nacionalidad_id: payload.nacionalidad_id,
        correo: payload.correo ?? null,
        objetivo: payload.objetivo ?? null,
        id_planes_pago: payload.id_planes_pago,
        id_entrenador: payload.id_entrenador ?? null,
        fecha_inicio: payload.fecha_inicio,
        fecha_fin: payload.fecha_fin,
        activo: payload.activo ?? true,
        id_horarios: payload.id_horarios,
        referencia_id: payload.referencia_id ?? null,
        is_deleted: false,
        created_at: payload.created_at ?? now,
        gym_id: payload.gym_id,
        source_device: payload.source_device ?? null,
        version: payload.version ?? 1,
        updated_at: now,
        deleted_at: null
      },
      update: {
        tipo_documento: payload.tipo_documento,
        fecha_nacimiento: payload.fecha_nacimiento ?? null,
        categoria: payload.categoria ?? "NUEVO",
        nombres: payload.nombres,
        apellidos: payload.apellidos,
        sexo: payload.sexo,
        foto_cliente: payload.foto_cliente ? Buffer.from(payload.foto_cliente) : null,
        cliente_peso_id: payload.cliente_peso_id,
        estatura_cliente: payload.estatura_cliente,
        direccion: payload.direccion ?? null,
        telefono: payload.telefono ?? null,
        nacionalidad_id: payload.nacionalidad_id,
        correo: payload.correo ?? null,
        objetivo: payload.objetivo ?? null,
        id_planes_pago: payload.id_planes_pago,
        id_entrenador: payload.id_entrenador ?? null,
        fecha_inicio: payload.fecha_inicio,
        fecha_fin: payload.fecha_fin,
        activo: payload.activo ?? true,
        id_horarios: payload.id_horarios,
        referencia_id: payload.referencia_id ?? null,
        gym_id: payload.gym_id,
        source_device: payload.source_device ?? null,
        is_deleted: false,
        version: payload.version ?? 1,
        updated_at: now,
        deleted_at: null
      }
      });
    });
  }

  async findAll(gymId: string): Promise<Cliente[]> {
    const result = await this.client.cliente.findMany({
      where: { gym_id: gymId, is_deleted: false }
    });
    const memberships = await this.client.membresiaCliente.findMany({
      where: {
        gym_id: gymId,
        ci: { in: result.map((client: any) => client.ci) },
        is_deleted: false,
        estado: { in: ["PENDIENTE_PAGO", "ACTIVA", "PAUSADA"] },
      },
      orderBy: [{ created_at: "desc" }, { updated_at: "desc" }],
    });
    const membershipByClient = new Map<string, typeof memberships[number]>();
    for (const membership of memberships) {
      if (!membershipByClient.has(membership.ci)) {
        membershipByClient.set(membership.ci, membership);
      }
    }
    const hoy = await this.fechaNegocio(gymId);
    return result.map((c: any) => ({
      ...c,
      foto_cliente: c.foto_cliente ? new Uint8Array(c.foto_cliente) : null,
      telefono: c.telefono == null ? null : Number(c.telefono),
      gym_id: c.gym_id ?? "",
      membresia_id: membershipByClient.get(c.ci)?.membresia_id ?? null,
      membresia_estado: membershipByClient.get(c.ci)?.estado ?? null,
      ...proyectarVigencia(membershipByClient.get(c.ci), hoy),
      membresia_precio: membershipByClient.has(c.ci)
        ? Number(membershipByClient.get(c.ci)!.precio_snapshot)
        : null,
      membresia_importe_pagado: membershipByClient.has(c.ci)
        ? Number(membershipByClient.get(c.ci)!.importe_pagado)
        : null,
      membresia_saldo_pendiente: membershipByClient.has(c.ci)
        ? Math.max(
            0,
            Number(membershipByClient.get(c.ci)!.precio_snapshot) -
              Number(membershipByClient.get(c.ci)!.importe_pagado),
          )
        : null,
    }));
  }

  async findById(id: string, gymId: string): Promise<Cliente | null> {
    const result = await this.client.cliente.findFirst({
      where: { ci: id, gym_id: gymId, is_deleted: false }
    });
    if (!result) return null;
    const membership = await this.client.membresiaCliente.findFirst({
      where: {
        ci: result.ci,
        gym_id: gymId,
        is_deleted: false,
        estado: { in: ["PENDIENTE_PAGO", "ACTIVA", "PAUSADA"] },
      },
      orderBy: [{ created_at: "desc" }, { updated_at: "desc" }],
    });
    return {
      ...result,
      foto_cliente: result.foto_cliente ? new Uint8Array(result.foto_cliente) : null,
      telefono: result.telefono == null ? null : Number(result.telefono),
      gym_id: result.gym_id ?? "",
      membresia_id: membership?.membresia_id ?? null,
      membresia_estado: membership?.estado ?? null,
      ...proyectarVigencia(membership, await this.fechaNegocio(gymId)),
      membresia_precio: membership ? Number(membership.precio_snapshot) : null,
      membresia_importe_pagado: membership ? Number(membership.importe_pagado) : null,
      membresia_saldo_pendiente: membership
        ? Math.max(0, Number(membership.precio_snapshot) - Number(membership.importe_pagado))
        : null,
    };
  }

  async findNationalityCode(nacionalidadId: string): Promise<string | null> {
    const nationality = await this.client.nacionalidad.findUnique({
      where: { nacionalidad_id: nacionalidadId },
      select: { codigo_iso: true, is_deleted: true },
    });
    return nationality && !nationality.is_deleted ? nationality.codigo_iso : null;
  }

  async create(data: Cliente): Promise<ClienteCreationResult> {
    return this.runInClient(async (tx) => {
      const now = trustedClock.nowUtc();
      if (!data.gym_id) {
        throw new Error("El token debe identificar el gimnasio del cliente.");
      }
      const plan = data.id_planes_pago
        ? await tx.planesPago.findFirst({
            where: {
              id_planes_pago: data.id_planes_pago,
              gym_id: data.gym_id,
              is_deleted: false,
            },
          })
        : null;
      const trainer = data.id_entrenador
        ? await tx.entrenador.findFirst({
            where: {
              id_entrenador: data.id_entrenador,
              gym_id: data.gym_id,
              is_deleted: false,
              activo_entrenador: true,
            },
            select: { id_entrenador: true },
          })
        : null;
      const schedule = data.id_horarios
        ? await tx.horario.findFirst({
            where: {
              horario_id: data.id_horarios,
              gym_id: data.gym_id,
              is_deleted: false,
            },
            select: { horario_id: true },
          })
        : null;
      const nationality = await tx.nacionalidad.findUnique({
        where: { nacionalidad_id: data.nacionalidad_id },
      });
      if (!nationality || nationality.is_deleted) {
        throw new Error("La nacionalidad seleccionada no está disponible.");
      }
      if (data.id_planes_pago && !plan) {
        throw new Error("El plan seleccionado no pertenece al gimnasio autenticado.");
      }
      if (data.id_entrenador && !trainer) {
        throw new Error("El entrenador seleccionado no pertenece al gimnasio autenticado.");
      }
      if (data.id_horarios && !schedule) {
        throw new Error("El horario seleccionado no pertenece al gimnasio autenticado.");
      }

      const client = await tx.cliente.create({ data: {
        ci: data.ci,
        tipo_documento: data.tipo_documento,
        // E0 y R5.3: los dos campos que este `create` tiraba al suelo.
        //
        // El caso de uso ya deriva la fecha del CI y trae la categoría, pero
        // ninguna llegaba a Prisma: `fecha_nacimiento` es opcional en el
        // esquema, así que quedaba NULL, y `categoria` tiene
        // `@default("NUEVO")`, así que un socio VIEJO dado de alta **desde la
        // web** se guardaba NUEVO —y la categoría decide el precio—. La
        // respuesta devolvía NUEVO sin avisar de nada.
        //
        // Es el mismo defecto que se corrigió el 31-07 en `upsertFromSync` y
        // que allí se quedó: se arregló la vía de sincronización y no la del
        // alta normal. Observado el 10-08-2026 contra las dos APIs con el mismo
        // cuerpo: escritorio guardó VIEJO y 1955-06-01; la web, NUEVO y NULL.
        fecha_nacimiento: data.fecha_nacimiento ?? null,
        categoria: data.categoria ?? "NUEVO",
        nombres: data.nombres,
        apellidos: data.apellidos,
        sexo: data.sexo,
        foto_cliente: data.foto_cliente ? Buffer.from(data.foto_cliente) : null,
        cliente_peso_id: data.cliente_peso_id,
        estatura_cliente: data.estatura_cliente,
        direccion: data.direccion ?? null,
        telefono: data.telefono ?? null,
        nacionalidad_id: data.nacionalidad_id,
        correo: data.correo ?? null,
        objetivo: data.objetivo ?? null,
        id_planes_pago: data.id_planes_pago,
        id_entrenador: data.id_entrenador ?? null,
        fecha_inicio: data.fecha_inicio,
        fecha_fin: data.fecha_fin,
        activo: plan ? false : (data.activo ?? true),
        id_horarios: data.id_horarios,
        referencia_id: data.referencia_id ?? null,
        is_deleted: false,
        created_at: data.created_at ?? now,
        gym_id: data.gym_id,
        source_device: data.source_device ?? null,
        version: data.version ?? 1,
        updated_at: now,
        deleted_at: null
      }});

      const membership = plan
        ? await tx.membresiaCliente.create({
            data: {
              membresia_id: randomUUID(),
              ci: client.ci,
              id_planes_pago: plan.id_planes_pago,
              id_entrenador: client.id_entrenador,
              plan_nombre_snapshot:
                plan.nombre_plan_pago?.trim() || plan.id_planes_pago,
              precio_snapshot: plan.importe_plan_pago,
              moneda_id: plan.moneda_id,
              duracion_dias_snapshot: plan.duracion_plan_pago,
              fecha_inicio: client.fecha_inicio,
              fecha_fin: client.fecha_fin,
              estado: "PENDIENTE_PAGO",
              origen: "ALTA",
              importe_pagado: 0,
              activada_at: null,
              reconstruida: false,
              confianza_reconstruccion: null,
              is_deleted: false,
              created_at: now,
              gym_id: data.gym_id!,
              source_device: "WEB_ADMIN",
              version: 1,
              updated_at: now,
              deleted_at: null,
            },
          })
        : null;
      const assignment = membership?.id_entrenador
        ? await tx.membresiaEntrenadorAsignacion.create({
            data: {
              asignacion_id: randomUUID(),
              membresia_id: membership.membresia_id,
              id_entrenador: membership.id_entrenador,
              fecha_inicio: membership.fecha_inicio,
              fecha_fin: null,
              estado: "PENDIENTE",
              motivo_cierre: null,
              is_deleted: false,
              created_at: now,
              gym_id: membership.gym_id,
              source_device: "WEB_ADMIN",
              version: 1,
              updated_at: now,
              deleted_at: null,
            },
          })
        : null;

      return {
        client: {
          ...client,
          foto_cliente: client.foto_cliente
            ? new Uint8Array(client.foto_cliente)
            : null,
          telefono: client.telefono == null ? null : Number(client.telefono),
          gym_id: client.gym_id ?? "",
        },
        membership,
        assignment,
        nationalityCode: nationality.codigo_iso,
      };
    });
  }

  async update(id: string, gymId: string, data: Partial<Cliente>): Promise<void> {
    await this.runInClient(async (tx) => {
      if (data.id_planes_pago) {
        const plan = await tx.planesPago.findFirst({
          where: {
            id_planes_pago: data.id_planes_pago,
            gym_id: gymId,
            is_deleted: false,
          },
          select: { id_planes_pago: true },
        });
        if (!plan) throw new Error("El plan seleccionado no pertenece al gimnasio autenticado.");
      }
      if (data.id_entrenador) {
        const trainer = await tx.entrenador.findFirst({
          where: {
            id_entrenador: data.id_entrenador,
            gym_id: gymId,
            is_deleted: false,
            activo_entrenador: true,
          },
          select: { id_entrenador: true },
        });
        if (!trainer) throw new Error("El entrenador seleccionado no pertenece al gimnasio autenticado.");
      }
      if (data.id_horarios) {
        const schedule = await tx.horario.findFirst({
          where: {
            horario_id: data.id_horarios,
            gym_id: gymId,
            is_deleted: false,
          },
          select: { horario_id: true },
        });
        if (!schedule) throw new Error("El horario seleccionado no pertenece al gimnasio autenticado.");
      }
      const result = await tx.cliente.updateMany({
        where: { ci: id, gym_id: gymId, is_deleted: false },
        data: {
        // E0 y R5.3, misma omisión que en `create`: la edición desde la web
        // respondía 200 y no cambiaba ni la fecha ni la categoría. Se envían
        // solo si vienen, para que editar un teléfono no pise lo demás.
        ...(data.fecha_nacimiento === undefined
          ? {}
          : { fecha_nacimiento: data.fecha_nacimiento }),
        ...(data.categoria === undefined ? {} : { categoria: data.categoria }),
        nombres: data.nombres,
        tipo_documento: data.tipo_documento,
        apellidos: data.apellidos,
        sexo: data.sexo,
        foto_cliente: data.foto_cliente ? Buffer.from(data.foto_cliente) : undefined,
        cliente_peso_id: data.cliente_peso_id,
        estatura_cliente: data.estatura_cliente,
        direccion: data.direccion ?? undefined,
        telefono: data.telefono ?? undefined,
        nacionalidad_id: data.nacionalidad_id,
        correo: data.correo ?? undefined,
        objetivo: data.objetivo ?? undefined,
        id_planes_pago: data.id_planes_pago,
        id_entrenador: data.id_entrenador ?? undefined,
        fecha_inicio: data.fecha_inicio,
        fecha_fin: data.fecha_fin,
        activo: data.activo,
        id_horarios: data.id_horarios,
        referencia_id: data.referencia_id ?? undefined,
        version: { increment: 1 },
        updated_at: trustedClock.nowUtc()
        },
      });
      if (result.count !== 1) throw new Error("Cliente not found");
    });
  }

  async softDelete(id: string, gymId: string): Promise<void> {
    const now = trustedClock.nowUtc();
    await softDeleteGymScopedSyncRecord({
      delegate: this.client.cliente,
      entity: "cliente",
      pk: "ci",
      id,
      gymId,
      now,
    });
  }
}
