import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class TreasuryMonthLockedError extends Error {
  readonly status = 409;

  constructor(
    readonly month: string,
    readonly closeId: string,
  ) {
    super(
      `El período ${month} está cerrado. Reábralo de forma auditada antes de registrar o modificar operaciones de Tesorería.`,
    );
    this.name = "TreasuryMonthLockedError";
  }
}

export async function assertTreasuryMonthOpen(
  tx: Tx,
  gymId: string,
  businessDate: Date,
) {
  const month = new Date(businessDate).toISOString().slice(0, 7);
  const lock = await tx.tesoreriaCierreMensual.findFirst({
    where: {
      gym_id: gymId,
      mes: month,
      estado: "CERRADO",
      bloqueo_clave: { not: null },
      is_deleted: false,
    },
    select: { cierre_mensual_id: true },
  });
  if (lock) {
    throw new TreasuryMonthLockedError(month, lock.cierre_mensual_id);
  }
}
