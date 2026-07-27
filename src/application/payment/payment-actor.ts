/**
 * R5.6 — quién recibió el dinero (docs/PAYMENT_COLLECTOR_ATTRIBUTION.md §4).
 *
 * Gemelo del módulo local, con la diferencia que impone el remoto: aquí solo
 * existe `User`, y además del usuario hay que revalidar **la sede**. El gimnasio
 * sale del token ya verificado; el JSON del pago no puede proponer usuario,
 * rol ni gimnasio.
 *
 * Un cobro que llega por **sincronización** no pasa por aquí: conserva el actor
 * congelado que fijó la API local y que el dispositivo autenticado sube como
 * parte del evento (§4, «Sincronización de un cobro local»). Sustituirlo por
 * quien sincroniza convertiría al dispositivo en recepcionista.
 */

export type PaymentActorOrigin = "LOCAL_USER" | "SYNCED_USER" | "REMOTE_USER";

export interface AuthenticatedPaymentActor {
  userId: string;
  nombre: string;
  rol: string;
  origen: PaymentActorOrigin;
}

export class PaymentActorError extends Error {
  constructor(message: string, readonly status: 401 | 403 | 503) {
    super(message);
    this.name = "PaymentActorError";
  }
}

type ActorClient = {
  user: {
    findFirst: (args: any) => Promise<any>;
  };
};

function displayName(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : fallback;
}

/** Resuelve el cobrador de un cobro hecho contra la API remota (web). */
export async function resolveRemotePaymentActor(
  client: ActorClient,
  input: { userId?: string | null; gymId: string },
): Promise<AuthenticatedPaymentActor> {
  const userId = (input.userId ?? "").trim();
  if (!userId) {
    throw new PaymentActorError(
      "El cobro exige una sesión iniciada: no se pudo identificar quién lo recibe.",
      401,
    );
  }

  let user: any;
  try {
    user = await client.user.findFirst({
      where: {
        user_id: userId,
        active: true,
        is_deleted: false,
        gym_id: input.gymId,
      },
      select: { user_id: true, user_nombre: true, role: true },
    });
  } catch (error: any) {
    throw new PaymentActorError(
      `No se pudo comprobar la identidad del cobrador: ${error?.message ?? error}`,
      503,
    );
  }

  if (!user) {
    throw new PaymentActorError(
      "La cuenta que intenta cobrar no está activa en este gimnasio.",
      403,
    );
  }

  return {
    userId: user.user_id,
    nombre: displayName(user.user_nombre, user.user_id),
    rol: displayName(user.role, "user"),
    origen: "REMOTE_USER",
  };
}

/**
 * Actor que llega dentro de un evento de sincronización: ya venía congelado
 * desde la instalación que cobró. Se acepta tal cual —incluido `LOCAL_USER`,
 * que puede no tener fila remota— o se descarta entero si viene incompleto.
 * Nunca se completa con el dispositivo que sube el evento.
 */
export function frozenActorFromSyncPayload(
  payload: Record<string, any> | null | undefined,
): AuthenticatedPaymentActor | null {
  const userId = String(payload?.cobrado_por_user_id ?? "").trim();
  const origen = String(payload?.cobrado_por_origen ?? "").trim();
  if (!userId || !origen) return null;
  if (origen !== "LOCAL_USER" && origen !== "SYNCED_USER" && origen !== "REMOTE_USER") {
    return null;
  }
  return {
    userId,
    nombre: displayName(payload?.cobrado_por_nombre_snapshot, userId),
    rol: displayName(payload?.cobrado_por_rol_snapshot, "user"),
    origen,
  };
}

/**
 * Puerto de resolución del cobrador. Existe para que el caso de uso no dependa
 * de Prisma y para poder sustituirlo en pruebas sin inventar identidades.
 */
export interface PaymentActorResolver {
  resolve(input: {
    userId?: string | null;
    gymId: string;
  }): Promise<AuthenticatedPaymentActor>;
}

export class PrismaPaymentActorResolver implements PaymentActorResolver {
  constructor(private readonly client: ActorClient) {}

  resolve(input: { userId?: string | null; gymId: string }) {
    return resolveRemotePaymentActor(this.client, input);
  }
}

/** Columnas del cobrador tal y como se persisten en pago y movimiento. */
export function collectorColumns(actor: AuthenticatedPaymentActor | null) {
  return {
    cobrado_por_user_id: actor?.userId ?? null,
    cobrado_por_nombre_snapshot: actor?.nombre ?? null,
    cobrado_por_rol_snapshot: actor?.rol ?? null,
    cobrado_por_origen: actor?.origen ?? null,
  };
}

export interface CollectorSnapshot {
  cobrado_por_user_id: string | null;
  cobrado_por_nombre_snapshot: string | null;
  cobrado_por_rol_snapshot: string | null;
  cobrado_por_origen: string | null;
}

/**
 * Copia el cobrador ya congelado de una fila (pago o movimiento). Se usa para
 * que el movimiento herede el del pago y para que el contramovimiento de un
 * reverso netee **el cobro original**, no a quien anula.
 */
export function collectorFromRow(row: any): CollectorSnapshot {
  return {
    cobrado_por_user_id: row?.cobrado_por_user_id ?? null,
    cobrado_por_nombre_snapshot: row?.cobrado_por_nombre_snapshot ?? null,
    cobrado_por_rol_snapshot: row?.cobrado_por_rol_snapshot ?? null,
    cobrado_por_origen: row?.cobrado_por_origen ?? null,
  };
}
