export type OperationalResultsPeriod = {
  month: string;
  start: Date;
  endExclusive: Date;
};

export type OperationalMovementReadRow = {
  movementId: string;
  direction: "ENTRADA" | "SALIDA";
  concept: string;
  /** `origen_tipo`. M4b lo necesita para reconocer el cobro por cuenta ajena. */
  sourceType: string | null;
  accountId: string | null;
  currencyId: string;
  amount: string;
  businessDate: Date;
  requiresReview: boolean;
};

export type OperationalAccountReadRow = {
  accountId: string;
  name: string;
  currencyId: string;
};

export type OperationalCurrencyReadRow = {
  currencyId: string;
  code: string;
};

export type OperationalDailyCloseReadRow = {
  accountId: string;
  currencyId: string;
  businessDate: Date;
};

export type OperationalMonthlyCloseReadRow = {
  monthlyCloseId: string;
  month: string;
  state: string;
  sha256: string;
  snapshotJson: string;
  closedAt: Date;
  reopenedAt: Date | null;
};

export type OperationalTrainerObligationApplicationReadRow = {
  amount: string;
  state: "APLICADA" | "REVERSADA";
  createdAt: Date;
  updatedAt: Date;
};

export type OperationalTrainerObligationReadRow = {
  referenceId: string;
  source: "COMISION" | "FIJO";
  trainerId: string;
  trainerName: string;
  currencyId: string;
  amount: string;
  earningMethod: string;
  periodStart: Date;
  periodEnd: Date;
  scheduledDate: Date;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  applications: OperationalTrainerObligationApplicationReadRow[];
};

export type OperationalRefundRequestReadRow = {
  adjustmentId: string;
  clientId: string;
  clientName: string;
  currencyId: string;
  amount: string;
  requestedAt: Date;
  events: Array<{
    type: "RESUELTO" | "REABIERTO";
    occurredAt: Date;
  }>;
};

export type OperationalResultsReadData = {
  movements: OperationalMovementReadRow[];
  accounts: OperationalAccountReadRow[];
  currencies: OperationalCurrencyReadRow[];
  dailyCloses: OperationalDailyCloseReadRow[];
  monthlyClose: OperationalMonthlyCloseReadRow | null;
  businessDate?: Date;
  trainerObligations?: OperationalTrainerObligationReadRow[];
  refundRequests?: OperationalRefundRequestReadRow[];
};

/**
 * Puerto de lectura del contexto Informes/BI. No crea movimientos, sync_log ni
 * cierres; la aplicación solo consume hechos de los contextos propietarios.
 */
export interface OperationalResultsReader {
  currentBusinessMonth(gymId: string): Promise<string>;
  readMonthlyCloses(
    gymId: string,
    year: string,
  ): Promise<OperationalMonthlyCloseReadRow[]>;
  read(
    gymId: string,
    period: OperationalResultsPeriod,
  ): Promise<OperationalResultsReadData>;
}

export interface OperationalResultsSnapshotProvider {
  get(input: { gymId: string; month?: unknown }): Promise<Record<string, any>>;
}
