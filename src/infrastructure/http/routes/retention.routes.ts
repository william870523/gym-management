import { Hono } from "hono";
import {
  RetentionQueryError,
  RetentionService,
} from "../../../application/retention/retention.service";
import {
  RetentionManagementError,
  RetentionManagementService,
} from "../../../application/retention/retention-management.service";

const routes = new Hono();
const service = new RetentionService();
const managementService = new RetentionManagementService();
const csvValues = (value?: string) => value
  ?.split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .slice(0, 50);
const handleManagement = (c: any, error: unknown) => {
  if (error instanceof RetentionManagementError) {
    return c.json({ error: error.message }, error.status);
  }
  throw error;
};

const userIdentity = (c: any) => {
  const auth = c.get("auth") as
    { sub?: string; role?: string; gymId?: string } | undefined;
  if (!auth?.sub || !auth.gymId || auth.role === "device") return null;
  return auth;
};

routes.post("/gestiones", async (c) => {
  const auth = userIdentity(c);
  if (!auth?.sub || !auth.gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const body = await c.req.json();
    const result = await managementService.create({
      gymId: auth.gymId,
      membershipId: String(body.membresia_id ?? ""),
      operationId: String(body.operation_id ?? ""),
      result: String(body.resultado ?? ""),
      channel: String(body.canal ?? ""),
      note: body.nota == null ? null : String(body.nota),
      reasonId: body.motivo_baja_id == null ? null : String(body.motivo_baja_id),
      promiseDate: body.promesa_fecha == null ? null : String(body.promesa_fecha),
      nextManagementDate: body.proxima_gestion_fecha == null
        ? null
        : String(body.proxima_gestion_fecha),
      userId: auth.sub,
    });
    return c.json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return handleManagement(c, error);
  }
});

routes.get("/:membershipId/gestiones", async (c) => {
  const auth = userIdentity(c);
  if (!auth?.gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const rows = await managementService.list(
      auth.gymId,
      c.req.param("membershipId"),
      Number(c.req.query("limite")) || 100,
    );
    return c.json({ data: rows, total: rows.length });
  } catch (error) {
    return handleManagement(c, error);
  }
});

routes.get("/", async (c) => {
  const auth = c.get("auth") as { gymId?: string; role?: string } | undefined;
  if (!auth?.gymId || auth.role === "device") {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const states = csvValues(c.req.query("estado"))?.map((value) => value.toUpperCase());
    return c.json(await service.getDashboard(auth.gymId, {
      from: c.req.query("desde"),
      to: c.req.query("hasta"),
      states,
      planIds: csvValues(c.req.query("plan_id")),
      trainerIds: csvValues(c.req.query("entrenador_id")),
    }));
  } catch (error) {
    if (error instanceof RetentionQueryError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }
});

export default routes;
