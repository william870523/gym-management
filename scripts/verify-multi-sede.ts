/**
 * Verificación reproducible de multi-sede M1 en la **web/remoto**
 * (docs/MULTI_SEDE.md §3 y §11, docs/DEMO_MULTI_SEDE.md).
 *
 * Ejercita el app Hono real. Gemela de la del escritorio, con la diferencia
 * que manda el diseño: aquí sí existe la cadena, así que el Dueño **abre otra
 * sede** con `X-Gym-Id`, mientras que en una instalación de escritorio esa
 * misma petición responde 404 —esa base solo tiene los datos de su sede—.
 *
 * Necesita la fixture instalada:  bun run demo:multi-sede
 *
 *   bun run verify:multi-sede
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { app } from "../src/infrastructure/http/server";
import {
  DEMO_GYM_ID,
  DEMO_SEDE_NORTE,
  DEMO_USERS,
  DEMO_USER_EMAILS,
  DEMO_USER_NAMES,
} from "../../scripts/demo-multi-sede";

let fallos = 0;

function check(etiqueta: string, ok: boolean, detalle: string) {
  const marca = ok ? "OK  " : "FALLA";
  if (!ok) fallos += 1;
  console.log(`  ${marca} ${etiqueta.padEnd(52)} ${detalle}`);
}

/** Token real de la web: el mismo que firma `POST /auth/login`. */
function token(userId: string, role: string, gymId: string) {
  return JwtService.signAdminToken({
    userId,
    role,
    email: DEMO_USER_EMAILS[userId as keyof typeof DEMO_USER_EMAILS],
    gymId,
  });
}

async function request(
  userToken: string,
  path: string,
  init: RequestInit & { gymId?: string } = {},
) {
  const { gymId, ...rest } = init;
  const response = await app.request(`http://gymos.test${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      ...(gymId ? { "X-Gym-Id": gymId } : {}),
      ...(rest.headers ?? {}),
    },
  });
  return { status: response.status, body: await response.text() };
}

async function main() {
  const propia = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;
  const dora = token(DEMO_USERS.dora, "admin", propia);
  const alba = token(DEMO_USERS.alba, "admin", propia);
  const rosa = token(DEMO_USERS.rosa, "reception", propia);

  console.log(`Sede por defecto de la fixture: ${propia}`);
  console.log(`Sede ajena de la fixture: ${DEMO_SEDE_NORTE}`);
  console.log("");

  console.log("Puerta cerrada:");
  const anonimo = await app.request("http://gymos.test/gyms");
  check("GET /gyms sin token", anonimo.status === 401, `HTTP ${anonimo.status}`);
  console.log("");

  console.log("Sedes que ve cada cuenta (GET /gyms):");
  for (const [userToken, userId] of [
    [dora, DEMO_USERS.dora],
    [alba, DEMO_USERS.alba],
    [rosa, DEMO_USERS.rosa],
  ] as const) {
    const r = await request(userToken, "/gyms");
    const sedes = r.status === 200 ? (JSON.parse(r.body) as any[]) : [];
    const ok = r.status === 200 &&
      (userId === DEMO_USERS.dora
        ? sedes.length > 1 && sedes.some((s) => s.gym_id === DEMO_SEDE_NORTE)
        : sedes.length === 1 && sedes[0]?.gym_id === propia);
    check(
      DEMO_USER_NAMES[userId],
      ok,
      `HTTP ${r.status} · ${sedes.length} sede(s)`,
    );
  }
  console.log("");

  console.log("Cabecera X-Gym-Id con la sede ajena:");
  const doraAjena = await request(dora, "/gyms", { gymId: DEMO_SEDE_NORTE });
  check(
    "Dueña de la cadena entra",
    doraAjena.status === 200,
    `HTTP ${doraAjena.status}`,
  );
  const albaAjena = await request(alba, "/gyms", { gymId: DEMO_SEDE_NORTE });
  check(
    "Administración de la sede queda fuera (404, no 403)",
    albaAjena.status === 404,
    `HTTP ${albaAjena.status} · ${albaAjena.body.slice(0, 60)}`,
  );
  const rosaAjena = await request(rosa, "/gyms", { gymId: DEMO_SEDE_NORTE });
  check(
    "Recepción queda fuera",
    rosaAjena.status === 404,
    `HTTP ${rosaAjena.status} · ${rosaAjena.body.slice(0, 60)}`,
  );
  console.log("");

  console.log("Alta de sede (POST /gyms):");
  const albaAlta = await request(alba, "/gyms", {
    method: "POST",
    body: JSON.stringify({ nombre: "Intento", codigo: "INT" }),
  });
  check(
    "Administración de la sede",
    albaAlta.status === 403 && albaAlta.body.includes("PLATFORM_AUTHORITY_REQUIRED"),
    `HTTP ${albaAlta.status} · ${albaAlta.body.slice(0, 70)}`,
  );
  const doraAlta = await request(dora, "/gyms", {
    method: "POST",
    body: JSON.stringify({ nombre: "", codigo: "" }),
  });
  check(
    "Dueña (payload inválido, a propósito)",
    doraAlta.status === 400,
    `HTTP ${doraAlta.status} · ${doraAlta.body.slice(0, 70)}`,
  );
  console.log("");

  console.log("Baja de sede (DELETE /gyms/:id):");
  const albaBaja = await request(alba, `/gyms/${DEMO_SEDE_NORTE}`, { method: "DELETE" });
  check(
    "Administración de la sede",
    albaBaja.status === 403,
    `HTTP ${albaBaja.status} · ${albaBaja.body.slice(0, 70)}`,
  );
  const doraBajaPropia = await request(dora, `/gyms/${propia}`, { method: "DELETE" });
  check(
    "Dueña sobre la sede ACTIVA",
    doraBajaPropia.status === 409 &&
      doraBajaPropia.body.includes("ACTIVE_GYM_CANNOT_BE_DELETED"),
    `HTTP ${doraBajaPropia.status} · ${doraBajaPropia.body.slice(0, 70)}`,
  );
  console.log("");

  console.log("Sesión resuelta (GET /auth/session):");
  for (const [userToken, userId, esperado] of [
    [dora, DEMO_USERS.dora, true],
    [alba, DEMO_USERS.alba, false],
    [rosa, DEMO_USERS.rosa, false],
  ] as const) {
    const r = await request(userToken, "/auth/session");
    const cuerpo = r.status === 200 ? JSON.parse(r.body) : {};
    check(
      DEMO_USER_NAMES[userId],
      r.status === 200 && cuerpo.es_plataforma === esperado &&
        cuerpo.gym_id === propia,
      `HTTP ${r.status} · sede ${cuerpo.gym_id} · dueño ${cuerpo.es_plataforma}`,
    );
  }
  // La sede activa de la sesión la decide el servidor a partir de la cabecera.
  const doraEnNorte = await request(dora, "/auth/session", { gymId: DEMO_SEDE_NORTE });
  const cuerpoNorte = doraEnNorte.status === 200 ? JSON.parse(doraEnNorte.body) : {};
  check(
    "Dueña con X-Gym-Id: la sesión cambia de sede",
    doraEnNorte.status === 200 && cuerpoNorte.gym_id === DEMO_SEDE_NORTE,
    `HTTP ${doraEnNorte.status} · sede ${cuerpoNorte.gym_id}`,
  );

  console.log("");
  if (fallos > 0) {
    throw new Error(`MULTI_SEDE_REMOTO_FAILED: ${fallos} comprobación(es) en rojo.`);
  }
  console.log("Todas las comprobaciones en verde.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
