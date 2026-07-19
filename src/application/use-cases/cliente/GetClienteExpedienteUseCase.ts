import type { ClienteExpedienteRepository } from "../../../domain/repositories/ClienteExpedienteRepository";

export class GetClienteExpedienteUseCase {
  constructor(private readonly repository: ClienteExpedienteRepository) {}

  execute(ci: string, gymId: string) {
    return this.repository.findByClient(ci, gymId);
  }
}
