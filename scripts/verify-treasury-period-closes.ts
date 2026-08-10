import { captureTreasuryPeriodEvidence } from "../../scripts/verify-treasury-period-closes";
import { TreasuryPeriodCloseService } from "../src/application/accounting/treasury-period-close.service";

const monthly = {
  summary: async () => ({}),
  close: async () => ({}),
  reopen: async () => ({}),
};
const service = new TreasuryPeriodCloseService(monthly);

await captureTreasuryPeriodEvidence({
  engine: "mariadb",
  summary: (range) => service.summary({
    gymId: "local-gym-001",
    ...range,
    userId: "dpc-user-carla",
    role: "admin",
  }),
  list: (range) => service.list({ gymId: "local-gym-001", ...range }),
});
