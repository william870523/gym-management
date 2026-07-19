import {
  buildMembershipRevenueReport,
  MembershipRevenuePolicyError,
} from "../../domain/membership-revenue-policy";
import type { MembershipRevenueReader } from "./membership-revenue.reader";

export class MembershipRevenueServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "MembershipRevenueServiceError";
  }
}

export class MembershipRevenueService {
  constructor(private readonly reader: MembershipRevenueReader) {}

  async get(input: { gymId: string; month?: unknown }) {
    if (!input.gymId.trim()) {
      throw new MembershipRevenueServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    const currentBusinessDate = await this.reader.currentBusinessDate(input.gymId);
    const month = String(input.month ?? "").trim()
      || currentBusinessDate.toISOString().slice(0, 7);
    const memberships = await this.reader.readMemberships(input.gymId);
    try {
      return buildMembershipRevenueReport({
        month,
        currentBusinessDate,
        memberships,
      });
    } catch (error) {
      if (error instanceof MembershipRevenuePolicyError) {
        throw new MembershipRevenueServiceError(error.message);
      }
      throw error;
    }
  }
}

export function asMembershipRevenueServiceError(error: unknown) {
  return error instanceof MembershipRevenueServiceError ? error : null;
}
