import { Hono } from "hono";
import { EntrenadorController } from "../controllers/EntrenadorController";

export const entrenadorRoutes = new Hono();
const controller = new EntrenadorController();

entrenadorRoutes.get("/", (c) => controller.list(c));
entrenadorRoutes.get("/:id/offboarding-impact", (c) => controller.offboardingImpact(c));
entrenadorRoutes.get("/:id/offboarding-case", (c) => controller.getOpenOffboardingCase(c));
entrenadorRoutes.post("/:id/offboarding-cases", (c) => controller.createOffboardingCase(c));
entrenadorRoutes.patch("/:id/offboarding-cases/:caseId/decisions/:membershipId", (c) => controller.updateOffboardingDecision(c));
entrenadorRoutes.get("/:id/offboarding-cases/:caseId/decisions/:membershipId/financial-preview", (c) => controller.previewOffboardingFinancial(c));
entrenadorRoutes.post("/:id/offboarding-cases/:caseId/decisions/:membershipId/financial-resolution", (c) => controller.resolveOffboardingFinancial(c));
entrenadorRoutes.post("/:id/offboarding-cases/:caseId/execute", (c) => controller.executeOffboardingCase(c));
entrenadorRoutes.get("/:id/offboarding-cases/:caseId/final-settlement", (c) => controller.previewFinalOffboardingSettlement(c));
entrenadorRoutes.post("/:id/offboarding-cases/:caseId/final-settlement", (c) => controller.createFinalOffboardingSettlement(c));
entrenadorRoutes.post("/:id/offboarding-cases/:caseId/final-settlement/close", (c) => controller.closeFinalOffboardingSettlement(c));
entrenadorRoutes.get("/:id", (c) => controller.getById(c));
entrenadorRoutes.post("/", (c) => controller.create(c));
entrenadorRoutes.put("/:id", (c) => controller.update(c));
entrenadorRoutes.delete("/:id", (c) => controller.delete(c));
