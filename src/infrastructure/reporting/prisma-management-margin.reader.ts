import type { ManagementMarginMonthlyCloseReader } from
  "../../application/reporting/management-margin.reader";
import { prisma } from "../db/prismaClient";

export class PrismaManagementMarginMonthlyCloseReader
  implements ManagementMarginMonthlyCloseReader {
  async readMonthlyClose(gymId: string, month: string) {
    const close = await prisma.tesoreriaCierreMensual.findFirst({
      where: {
        gym_id: gymId,
        mes: month,
        estado: "CERRADO",
        bloqueo_clave: { not: null },
        is_deleted: false,
      },
      orderBy: [{ cerrado_at: "desc" }, { cierre_mensual_id: "desc" }],
    });
    return close
      ? {
          monthlyCloseId: close.cierre_mensual_id,
          month: close.mes,
          state: close.estado,
          sha256: close.resumen_sha256,
          snapshotJson: close.resumen_snapshot_json,
          closedAt: close.cerrado_at,
          reopenedAt: close.reabierto_at,
          lockKey: close.bloqueo_clave,
        }
      : null;
  }

  async readMonthlyCloses(gymId: string, year: string) {
    const closes = await prisma.tesoreriaCierreMensual.findMany({
      where: {
        gym_id: gymId,
        mes: { gte: `${year}-01`, lte: `${year}-12` },
        is_deleted: false,
      },
      orderBy: [{ cerrado_at: "desc" }, { cierre_mensual_id: "desc" }],
    });
    return closes.map((close) => ({
      monthlyCloseId: close.cierre_mensual_id,
      month: close.mes,
      state: close.estado,
      sha256: close.resumen_sha256,
      snapshotJson: close.resumen_snapshot_json,
      closedAt: close.cerrado_at,
      reopenedAt: close.reabierto_at,
      lockKey: close.bloqueo_clave,
    }));
  }
}
