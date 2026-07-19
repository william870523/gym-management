import type { TrainerServiceCostSnapshot } from "../../domain/trainer-service-cost-policy";

export interface TrainerServiceCostReader {
  currentBusinessDate(gymId: string): Promise<Date>;
  readCosts(gymId: string): Promise<TrainerServiceCostSnapshot[]>;
}

