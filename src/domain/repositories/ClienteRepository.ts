import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { Cliente } from "../entities/Cliente";
import type {
  MembresiaCliente,
  MembresiaEntrenadorAsignacion,
} from "@prisma/client";

export interface ClienteCreationResult {
  client: Cliente;
  membership: MembresiaCliente | null;
  assignment: MembresiaEntrenadorAsignacion | null;
  nationalityCode: string;
}

export interface ClienteRepository extends SyncTransactionalRepository<ClienteRepository> {
  upsertFromSync(data: Cliente): Promise<void>;
  findAll(gymId: string): Promise<Cliente[]>;
  findById(id: string, gymId: string): Promise<Cliente | null>;
  findNationalityCode(nacionalidadId: string): Promise<string | null>;
  create(data: Cliente): Promise<ClienteCreationResult>;
  update(id: string, gymId: string, data: Partial<Cliente>): Promise<void>;
  softDelete(id: string, gymId: string): Promise<void>;
}
