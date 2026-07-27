import type { SyncTransactionContext } from "./sync-transaction";
// src/application/use-cases/sync/ApplyClienteEventUseCase.ts
import type { Cliente } from "../../../domain/entities/Cliente";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import { normalizeBinary } from "../../../shared/utils/normalizeBinary";


export interface ApplyClienteEventInput {
  eventId: string;
  entidadId: string;
  operacion: SyncOperacion;
  gymId: string;
  deviceId: string;
  payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyClienteEventUseCase {
  constructor(
    private readonly clienteRepository: ClienteRepository
  ) { }

  // Aplica y registra un evento de cliente proveniente de la sincronizacion.
  async execute(input: ApplyClienteEventInput): Promise<{ processed: boolean }> {
      const repo = input.tx
          ? this.clienteRepository.withTransaction(input.tx)
          : this.clienteRepository;
    const { operacion } = input;

    if (operacion === "DELETE") {
      await repo.softDelete(input.entidadId, input.gymId);
    } else {
      const cliente = this.mapPayloadToCliente(input);
      await repo.upsertFromSync(cliente);
    }

    return { processed: true };
  }

  // Convierte el payload del evento en la entidad de dominio Cliente.
  private mapPayloadToCliente(input: ApplyClienteEventInput): Cliente {
    const payload = input.payload as Record<string, unknown>;
    const planId = typeof payload.id_planes_pago === "string" && payload.id_planes_pago.length > 0
      ? payload.id_planes_pago
      : null;

    return {
      ci: input.entidadId,
      tipo_documento: String(payload.tipo_documento ?? "DESCONOCIDO"),
      nombres: String(payload.nombres),
      apellidos: String(payload.apellidos),
      sexo: String(payload.sexo),
      foto_cliente: normalizeBinary(payload.foto_cliente),
      cliente_peso_id: String(payload.cliente_peso_id),
      estatura_cliente: Number(payload.estatura_cliente),
      direccion: (payload.direccion as string | null) ?? null,
      telefono: payload.telefono ? Number(payload.telefono) : null,
      nacionalidad_id: String(payload.nacionalidad_id),
      correo: (payload.correo as string | null) ?? null,
      objetivo: (payload.objetivo as string | null) ?? null,
      id_planes_pago: planId,
      id_entrenador: (payload.id_entrenador as string | null) ?? null,
      fecha_inicio: new Date(String(payload.fecha_inicio)),
      fecha_fin: new Date(String(payload.fecha_fin)),
      activo: Boolean(payload.activo),
      id_horarios: (payload.id_horarios as string | null) ?? null,
      referencia_id: (payload.referencia_id as string | null) ?? null,
      // R5.3: categoría del cliente; default NUEVO si no viene en el payload.
      categoria: String(payload.categoria ?? "NUEVO"),
      gym_id: input.gymId,
      source_device: input.deviceId,
      version: (payload.version as number) ?? 1,
      created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date()
    };
  }
}
