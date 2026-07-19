export interface ClienteExpedienteRepository {
  findByClient(ci: string, gymId: string): Promise<unknown | null>;
}
