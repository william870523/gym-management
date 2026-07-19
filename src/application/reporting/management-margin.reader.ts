export type ManagementMarginMonthlyCloseReadRow = {
  monthlyCloseId: string;
  month: string;
  state: string;
  sha256: string;
  snapshotJson: string;
  closedAt: Date;
  reopenedAt: Date | null;
  /**
   * Clave de bloqueo del cierre mensual. R4.5.1 exige que un cierre CERRADO la
   * conserve; si es `null` el mes se expone como BLOQUEO_INVALIDO en la
   * comparativa anual en vez de certificarse.
   */
  lockKey: string | null;
};

export interface ManagementMarginMonthlyCloseReader {
  readMonthlyClose(
    gymId: string,
    month: string,
  ): Promise<ManagementMarginMonthlyCloseReadRow | null>;
  readMonthlyCloses(
    gymId: string,
    year: string,
  ): Promise<ManagementMarginMonthlyCloseReadRow[]>;
}

export interface ManagementMarginSnapshotProvider {
  get(input: { gymId: string; month?: unknown }): Promise<Record<string, any>>;
}
