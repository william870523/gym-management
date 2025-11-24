import type { Cliente } from "../entities/Cliente";

export interface ClienteRepository {
  upsertFromSync(data: Cliente): Promise<void>;
  findAll(): Promise<Cliente[]>;
  findById(id: string): Promise<Cliente | null>;
  create(data: Cliente): Promise<void>;
  update(id: string, data: Partial<Cliente>): Promise<void>;
  softDelete(id: string): Promise<void>;
}
