import type { Cliente } from "../../domain/entities/Cliente";
import type { ClienteRepository } from "../../domain/repositories/ClienteRepository";
import { prisma } from "../db/prismaClient";
import type { ClienteCreationResult } from "../../domain/repositories/ClienteRepository";
import { trustedClock } from "../../config/trusted-clock";
import { randomUUID } from "crypto";

export class PrismaClienteRepository implements ClienteRepository {
  // Guarda o actualiza un cliente a partir de un evento de sincronizacion.
  async upsertFromSync(payload: Cliente): Promise<void> {
    await prisma.cliente.upsert({
      where: { ci: payload.ci },
      create: {
        ci: payload.ci,
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
        created_at: payload.created_at ?? new Date(),
        gym_id: payload.gym_id,
        source_device: payload.source_device ?? null,
        version: payload.version ?? 1,
        updated_at: new Date(),
        deleted_at: null
      },
      update: {
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
        updated_at: new Date(),
        deleted_at: null
      }
    });
  }

  async findAll(): Promise<Cliente[]> {
    const result = await prisma.cliente.findMany({
      where: { is_deleted: false }
    });
    const memberships = await prisma.membresiaCliente.findMany({
      where: {
        ci: { in: result.map((client) => client.ci) },
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
    return result.map(c => ({
      ...c,
      foto_cliente: c.foto_cliente ? new Uint8Array(c.foto_cliente) : null,
      telefono: c.telefono == null ? null : Number(c.telefono),
      gym_id: c.gym_id ?? "",
      membresia_id: membershipByClient.get(c.ci)?.membresia_id ?? null,
      membresia_estado: membershipByClient.get(c.ci)?.estado ?? null,
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

  async findById(id: string): Promise<Cliente | null> {
    const result = await prisma.cliente.findUnique({
      where: { ci: id, is_deleted: false }
    });
    if (!result) return null;
    const membership = await prisma.membresiaCliente.findFirst({
      where: {
        ci: result.ci,
        gym_id: result.gym_id ?? undefined,
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
      membresia_precio: membership ? Number(membership.precio_snapshot) : null,
      membresia_importe_pagado: membership ? Number(membership.importe_pagado) : null,
      membresia_saldo_pendiente: membership
        ? Math.max(0, Number(membership.precio_snapshot) - Number(membership.importe_pagado))
        : null,
    };
  }

  async findNationalityCode(nacionalidadId: string): Promise<string | null> {
    const nationality = await prisma.nacionalidad.findUnique({
      where: { nacionalidad_id: nacionalidadId },
      select: { codigo_iso: true, is_deleted: true },
    });
    return nationality && !nationality.is_deleted ? nationality.codigo_iso : null;
  }

  async create(data: Cliente): Promise<ClienteCreationResult> {
    return prisma.$transaction(async (tx) => {
      const now = trustedClock.nowUtc();
      const plan = data.id_planes_pago
        ? await tx.planesPago.findUnique({
            where: { id_planes_pago: data.id_planes_pago },
          })
        : null;
      const nationality = await tx.nacionalidad.findUnique({
        where: { nacionalidad_id: data.nacionalidad_id },
      });
      if (!nationality || nationality.is_deleted) {
        throw new Error("La nacionalidad seleccionada no está disponible.");
      }
      if (data.id_planes_pago && !plan) {
        throw new Error(`Plan ${data.id_planes_pago} no encontrado.`);
      }
      if (plan && !data.gym_id) {
        throw new Error("El token debe identificar el gimnasio del cliente.");
      }

      const client = await tx.cliente.create({ data: {
        ci: data.ci,
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

  async update(id: string, data: Partial<Cliente>): Promise<void> {
    await prisma.cliente.update({
      where: { ci: id },
      data: {
        nombres: data.nombres,
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
        gym_id: data.gym_id ?? undefined,
        version: { increment: 1 },
        updated_at: trustedClock.nowUtc()
      }
    });
  }

  async softDelete(id: string): Promise<void> {
    await prisma.cliente.update({
      where: { ci: id },
      data: {
        is_deleted: true,
        deleted_at: trustedClock.nowUtc(),
        updated_at: trustedClock.nowUtc()
      }
    });
  }
}
