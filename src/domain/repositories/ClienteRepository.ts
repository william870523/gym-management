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

export interface ClienteRepository {
  upsertFromSync(data: Cliente): Promise<void>;
  findAll(): Promise<Cliente[]>;
  findById(id: string): Promise<Cliente | null>;
  findNationalityCode(nacionalidadId: string): Promise<string | null>;
  create(data: Cliente): Promise<ClienteCreationResult>;
  update(id: string, data: Partial<Cliente>): Promise<void>;
  softDelete(id: string): Promise<void>;
}
