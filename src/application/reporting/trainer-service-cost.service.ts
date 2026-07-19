import {
  buildTrainerServiceCostReport,
  TrainerServiceCostPolicyError,
} from "../../domain/trainer-service-cost-policy";
import type { TrainerServiceCostReader } from "./trainer-service-cost.reader";

export class TrainerServiceCostServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "TrainerServiceCostServiceError";
  }
}

export class TrainerServiceCostService {
  constructor(private readonly reader: TrainerServiceCostReader) {}

  async get(input: { gymId: string; month?: unknown }) {
    try {
      const currentBusinessDate = await this.reader.currentBusinessDate(input.gymId);
      const month = input.month ?? currentBusinessDate.toISOString().slice(0, 7);
      const costs = await this.reader.readCosts(input.gymId);
      return buildTrainerServiceCostReport({ month, currentBusinessDate, costs });
    } catch (error) {
      if (error instanceof TrainerServiceCostPolicyError) {
        throw new TrainerServiceCostServiceError(error.message);
      }
      throw error;
    }
  }
}

export function asTrainerServiceCostServiceError(error: unknown) {
  return error instanceof TrainerServiceCostServiceError ? error : null;
}

