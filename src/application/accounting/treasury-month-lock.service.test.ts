import { describe, expect, test } from "bun:test";
import {
  assertTreasuryMonthOpen,
  TreasuryMonthLockedError,
} from "./treasury-month-lock.service";

describe("remote treasury monthly lock parity", () => {
  test("usa gimnasio, mes comercial y cierre activo", async () => {
    let where: any;
    const tx = {
      tesoreriaCierreMensual: {
        findFirst: async (input: any) => {
          where = input.where;
          return { cierre_mensual_id: "remote-close-1" };
        },
      },
    } as any;
    await expect(
      assertTreasuryMonthOpen(
        tx,
        "gym-remote",
        new Date("2025-12-31T00:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(TreasuryMonthLockedError);
    expect(where).toMatchObject({
      gym_id: "gym-remote",
      mes: "2025-12",
      estado: "CERRADO",
      is_deleted: false,
    });
  });
});
