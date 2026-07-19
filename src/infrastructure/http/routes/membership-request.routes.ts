import { Hono } from "hono";
import {
  MembershipRequestError,
  MembershipRequestService,
} from "../../../application/membership/membership-request.service";

const routes = new Hono();
const service = new MembershipRequestService();

const isAdmin = (role?: string) => {
  const normalized = role?.toLowerCase();
  return normalized === "admin" || normalized === "administrador";
};
const handle = (c: any, error: unknown) => {
  if (error instanceof MembershipRequestError) {
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

routes.post("/", async (c) => {
  const auth = userIdentity(c);
  if (!auth?.sub || !auth.gymId) {
    return c.json(
      { error: "Se requiere una cuenta de usuario del gimnasio." },
      403,
    );
  }
  try {
    const body = await c.req.json();
    const result = await service.create({
      gymId: auth.gymId,
      clientId: String(body.ci ?? ""),
      membershipId: String(body.membresia_id ?? ""),
      kind: String(body.tipo ?? ""),
      operationId: String(body.operation_id ?? ""),
      reason: String(body.motivo ?? ""),
      userId: auth.sub,
    });
    return c.json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return handle(c, error);
  }
});

routes.get("/", async (c) => {
  const auth = userIdentity(c);
  if (!auth?.sub || !auth.gymId) {
    return c.json(
      { error: "Se requiere una cuenta de usuario del gimnasio." },
      403,
    );
  }
  try {
    const requests = await service.list({
      gymId: auth.gymId,
      state: c.req.query("estado"),
      limit: Number(c.req.query("limite")) || 100,
      userId: auth.sub,
      onlyMine: !isAdmin(auth.role),
    });
    return c.json({ data: requests, total: requests.length });
  } catch (error) {
    return handle(c, error);
  }
});

routes.post("/:id/aprobar", async (c) => {
  const auth = userIdentity(c);
  if (!auth?.sub || !auth.gymId || !isAdmin(auth.role)) {
    return c.json(
      { error: "Solo administración puede aprobar solicitudes." },
      403,
    );
  }
  try {
    const body = await c.req.json();
    return c.json(
      await service.approve({
        gymId: auth.gymId,
        requestId: c.req.param("id"),
        operationId: String(body.operation_id ?? ""),
        adminUserId: auth.sub,
        decisionReason: body.motivo == null ? null : String(body.motivo),
      }),
    );
  } catch (error) {
    return handle(c, error);
  }
});

routes.post("/:id/rechazar", async (c) => {
  const auth = userIdentity(c);
  if (!auth?.sub || !auth.gymId || !isAdmin(auth.role)) {
    return c.json(
      { error: "Solo administración puede rechazar solicitudes." },
      403,
    );
  }
  try {
    const body = await c.req.json();
    return c.json(
      await service.reject({
        gymId: auth.gymId,
        requestId: c.req.param("id"),
        operationId: String(body.operation_id ?? ""),
        adminUserId: auth.sub,
        decisionReason: String(body.motivo ?? ""),
      }),
    );
  } catch (error) {
    return handle(c, error);
  }
});

export default routes;
