import type { MembershipRevenueSnapshot } from "../../domain/membership-revenue-policy";

/**
 * Puerto de lectura del contexto Informes/BI. Consume contratos y evidencias
 * financieras, pero no modifica membresías, pagos, cierres ni sincronización.
 */
export interface MembershipRevenueReader {
  currentBusinessDate(gymId: string): Promise<Date>;
  readMemberships(gymId: string): Promise<MembershipRevenueSnapshot[]>;
}
