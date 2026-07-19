import { describe, expect, test } from "bun:test";
import type { MembershipRevenueReader } from "./membership-revenue.reader";
import {
  MembershipRevenueService,
  MembershipRevenueServiceError,
} from "./membership-revenue.service";

class FakeReader implements MembershipRevenueReader {
  gymIds: string[] = [];

  async currentBusinessDate(gymId: string) {
    this.gymIds.push(gymId);
    return new Date("2026-07-18T00:00:00.000Z");
  }

  async readMemberships(gymId: string) {
    this.gymIds.push(gymId);
    return [];
  }
}

describe("MembershipRevenueService", () => {
  test("usa el mes de negocio y conserva el alcance del gimnasio", async () => {
    const reader = new FakeReader();
    const result = await new MembershipRevenueService(reader).get({
      gymId: "gym-demo",
    });

    expect(result.mes).toBe("2026-07");
    expect(result.estado_periodo).toBe("PROVISIONAL");
    expect(reader.gymIds).toEqual(["gym-demo", "gym-demo"]);
  });

  test("rechaza un gimnasio vacío antes de consultar datos", async () => {
    const reader = new FakeReader();
    await expect(
      new MembershipRevenueService(reader).get({ gymId: "  " }),
    ).rejects.toBeInstanceOf(MembershipRevenueServiceError);
    expect(reader.gymIds).toEqual([]);
  });

  test("convierte un mes ambiguo en error de aplicación", async () => {
    const service = new MembershipRevenueService(new FakeReader());
    await expect(
      service.get({ gymId: "gym-demo", month: "07/2026" }),
    ).rejects.toBeInstanceOf(MembershipRevenueServiceError);
  });
});

