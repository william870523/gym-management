import type { Cliente } from "../../domain/entities/Cliente";
import type { ClienteRepository } from "../../domain/repositories/ClienteRepository";
import { prisma } from "../db/prismaClient";

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
    return result.map(c => ({
      ...c,
      foto_cliente: c.foto_cliente ? new Uint8Array(c.foto_cliente) : null,
      gym_id: c.gym_id ?? ""
    }));
  }

  async findById(id: string): Promise<Cliente | null> {
    const result = await prisma.cliente.findUnique({
      where: { ci: id, is_deleted: false }
    });
    if (!result) return null;
    return {
      ...result,
      foto_cliente: result.foto_cliente ? new Uint8Array(result.foto_cliente) : null,
      gym_id: result.gym_id ?? ""
    };
  }

  async create(data: Cliente): Promise<void> {
    await prisma.cliente.create({
      data: {
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
        activo: data.activo ?? true,
        id_horarios: data.id_horarios,
        referencia_id: data.referencia_id ?? null,
        is_deleted: false,
        created_at: data.created_at ?? new Date(),
        gym_id: data.gym_id,
        source_device: data.source_device ?? null,
        version: data.version ?? 1,
        updated_at: new Date(),
        deleted_at: null
      }
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
        updated_at: new Date()
      }
    });
  }

  async softDelete(id: string): Promise<void> {
    await prisma.cliente.update({
      where: { ci: id },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date()
      }
    });
  }
}
