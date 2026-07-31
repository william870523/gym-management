/**
 * Actor congelado de los actos de contabilidad (unidad 09, paridad con R5.6).
 *
 * Gemelo de `gym-local-api/src/application/accounting/frozen-actor.ts`. El
 * motivo completo está allí; en corto: quién registró un gasto o firmó un
 * cierre se congela en la fila —identificador, nombre, rol y origen— y viaja
 * dentro del evento, porque una cuenta `LOCAL_USER` del escritorio puede no
 * tener nunca fila aquí y aun así ser la autora.
 *
 * La diferencia con el gemelo local es la esperada: aquí solo existe una tabla
 * de usuarios, así que quien opera por la web siempre es `REMOTE_USER`.
 */
import {
  resolveRemotePaymentActor,
  type AuthenticatedPaymentActor,
  type PaymentActorOrigin,
} from "../payment/payment-actor";

/**
 * `SYSTEM` no es una persona: es la generación mensual automática de gastos
 * recurrentes, que no ocurre bajo ninguna sesión. Se distingue del resto para
 * que un informe nunca atribuya a un empleado un gasto que nadie tecleó.
 */
export type FrozenActorOrigin = PaymentActorOrigin | "SYSTEM";

export interface FrozenActor {
  userId: string;
  nombre: string;
  rol: string;
  origen: FrozenActorOrigin;
}

export const SYSTEM_ACTOR: FrozenActor = {
  userId: "SYSTEM",
  nombre: "Sistema",
  rol: "sistema",
  origen: "SYSTEM",
};

type ActorClient = Parameters<typeof resolveRemotePaymentActor>[0];

function isSystem(userId: string | null | undefined) {
  const value = (userId ?? "").trim();
  return value.length === 0 || value.toUpperCase() === "SYSTEM";
}

/**
 * Resuelve quién está realizando el acto. Falla cerrado igual que el cobro:
 * una sesión que no se puede identificar no registra gasto ni firma cierre.
 * Solo la generación automática entra como `SYSTEM`.
 */
export async function resolveFrozenActor(
  client: ActorClient,
  input: { userId: string | null | undefined; gymId: string },
): Promise<FrozenActor> {
  if (isSystem(input.userId)) return SYSTEM_ACTOR;
  const actor: AuthenticatedPaymentActor = await resolveRemotePaymentActor(
    client,
    input,
  );
  return actor;
}

/** Columnas del actor que registró un gasto gobernado. */
export function registeredByColumns(actor: FrozenActor) {
  return {
    registrada_por_user_id: actor.userId,
    registrada_por_nombre_snapshot: actor.nombre,
    registrada_por_rol_snapshot: actor.rol,
    registrada_por_origen: actor.origen,
  };
}

/**
 * Orígenes que un evento de sincronización puede declarar. Se valida el
 * conjunto, no la existencia de una fila en `User`: esa comprobación es
 * justamente la que R5.6 declaró imposible para las cuentas locales, y la que
 * dejaba los gastos del escritorio atascados en el outbox.
 */
const ORIGENES_VALIDOS = new Set<string>([
  "LOCAL_USER",
  "SYNCED_USER",
  "REMOTE_USER",
  "SYSTEM",
]);

export function isValidFrozenActorOrigin(value: unknown): boolean {
  return ORIGENES_VALIDOS.has(String(value ?? "").trim());
}

/**
 * Valida el actor congelado que llega dentro de un evento de sincronización.
 * Se acepta tal cual o se rechaza entero: nunca se completa con el dispositivo
 * que sube el evento ni con el usuario del token.
 */
export function frozenActorIsValid(input: {
  userId: unknown;
  origen: unknown;
}): boolean {
  const userId = String(input.userId ?? "").trim();
  if (!userId) return false;
  return isValidFrozenActorOrigin(input.origen);
}
