import { prisma } from "../src/infrastructure/db/prismaClient";
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { app } from "../src/infrastructure/http/server";
import { assertGymScopedReference } from "../src/infrastructure/repositories/gym-scoped-reference";
import {
  TENANT_ISOLATION_IDS as I,
  installTenantIsolationDemo,
  removeTenantIsolationDemo,
} from "../../scripts/demo-tenant-isolation";

type Probe = {
  label: string;
  path: string;
  ownId?: string;
  foreignId?: string;
  expectedStatus?: number;
};

const remove = process.argv.includes("--remove");

function fail(message: string): never {
  throw new Error(`TENANT_ISOLATION_FAILED: ${message}`);
}

async function request(
  token: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await app.request(`http://gymos.test${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: await response.text() };
}

async function runListProbe(token: string, probe: Probe) {
  const result = await request(token, probe.path);
  if (result.status !== (probe.expectedStatus ?? 200)) {
    fail(`${probe.label}: HTTP ${result.status}; body=${result.body}`);
  }
  if (probe.ownId && !result.body.includes(probe.ownId)) {
    fail(`${probe.label}: no contiene el registro propio ${probe.ownId}`);
  }
  if (probe.foreignId && result.body.includes(probe.foreignId)) {
    fail(`${probe.label}: filtró el registro ajeno ${probe.foreignId}`);
  }
}

async function runDeniedProbe(token: string, probe: Probe) {
  const result = await request(token, probe.path);
  if (result.status !== (probe.expectedStatus ?? 404)) {
    fail(`${probe.label}: esperaba 404 y obtuvo ${result.status}; body=${result.body}`);
  }
  if (probe.foreignId && result.body.includes(probe.foreignId)) {
    fail(`${probe.label}: la respuesta reveló el identificador ajeno`);
  }
}

async function main() {
  if (remove) {
    const syncBefore = await prisma.syncLog.count();
    await removeTenantIsolationDemo(prisma);
    await removeTenantIsolationDemo(prisma);
    const [memberships, users, gyms, syncAfter] = await Promise.all([
      prisma.usuarioSede.count({
        where: { usuario_sede_id: { in: [I.membershipA, I.membershipB] } },
      }),
      prisma.user.count({ where: { user_id: { in: [I.userA, I.userB] } } }),
      prisma.gym.count({ where: { gym_id: { in: [I.gymA, I.gymB] } } }),
      prisma.syncLog.count(),
    ]);
    if (memberships !== 0 || users !== 0 || gyms !== 0) {
      fail(
        `teardown incompleto: usuario_sede=${memberships}, users=${users}, gyms=${gyms}`,
      );
    }
    if (syncAfter !== syncBefore) {
      fail(`el teardown alteró sync_log: ${syncBefore} -> ${syncAfter}`);
    }
    console.log(JSON.stringify({
      result: "PASS",
      operation: "double-remove",
      remaining: { usuario_sede: memberships, users, gyms },
      sync_log: { before: syncBefore, after: syncAfter, delta: 0 },
    }, null, 2));
    return;
  }

  const syncBefore = await prisma.syncLog.count();
  await installTenantIsolationDemo(prisma);
  await installTenantIsolationDemo(prisma);

  const memberships = await prisma.usuarioSede.findMany({
    where: { usuario_sede_id: { in: [I.membershipA, I.membershipB] } },
    orderBy: { usuario_sede_id: "asc" },
  });
  const expectedMemberships = new Map<string, { userId: string; gymId: string }>([
    [I.membershipA, { userId: I.userA, gymId: I.gymA }],
    [I.membershipB, { userId: I.userB, gymId: I.gymB }],
  ]);
  if (memberships.length !== 2) {
    fail(`la instalación doble dejó ${memberships.length} membresías; esperaba 2`);
  }
  for (const membership of memberships) {
    const expected = expectedMemberships.get(membership.usuario_sede_id);
    if (
      !expected ||
      membership.user_id !== expected.userId ||
      membership.gym_id !== expected.gymId ||
      membership.rol !== "admin" ||
      !membership.activo ||
      membership.is_deleted ||
      membership.deleted_at !== null
    ) {
      fail(`membresía inválida ${membership.usuario_sede_id}`);
    }
  }

  const tokenA = JwtService.signAdminToken({
    userId: I.userA,
    role: "admin",
    gymId: I.gymA,
  });

  const listProbes: Probe[] = [
    { label: "gyms", path: "/gyms", ownId: I.gymA, foreignId: I.gymB },
    { label: "users", path: "/users", ownId: I.userA, foreignId: I.userB },
    { label: "catalogs/horarios", path: "/catalogs/horarios", ownId: I.horarioA, foreignId: I.horarioB },
    { label: "horarios", path: "/horarios", ownId: I.horarioA, foreignId: I.horarioB },
    { label: "catalogs/planes-pago", path: "/catalogs/planes-pago", ownId: I.planA, foreignId: I.planB },
    { label: "planes-pago", path: "/planes-pago", ownId: I.planA, foreignId: I.planB },
    { label: "catalogs/cuentas", path: "/catalogs/cuentas", ownId: I.cuentaA, foreignId: I.cuentaB },
    { label: "cuentas", path: "/cuentas", ownId: I.cuentaA, foreignId: I.cuentaB },
    { label: "clients/clientes", path: "/clients/clientes", ownId: I.clientA, foreignId: I.clientB },
    { label: "clientes", path: "/clientes", ownId: I.clientA, foreignId: I.clientB },
    { label: "trainers/entrenadores", path: "/trainers/entrenadores", ownId: I.trainerA, foreignId: I.trainerB },
    { label: "entrenadores", path: "/entrenadores", ownId: I.trainerA, foreignId: I.trainerB },
    { label: "client weights", path: `/clients/clientes/${I.clientA}/pesos`, ownId: I.weightA, foreignId: I.weightB },
    { label: "cliente-pesos", path: `/cliente-pesos?ci=${I.clientA}`, ownId: I.weightA, foreignId: I.weightB },
    { label: "cliente-pesos foreign ci", path: `/cliente-pesos?ci=${I.clientB}`, foreignId: I.weightB },
    { label: "client attendance", path: `/clients/clientes/${I.clientA}/asistencias`, ownId: I.attendanceA, foreignId: I.attendanceB },
    { label: "asistencias", path: "/asistencias", ownId: I.attendanceA, foreignId: I.attendanceB },
    { label: "asistencias/hoy ignores query gym", path: `/asistencias/hoy?gym_id=${I.gymB}`, foreignId: I.attendanceB },
    { label: "payments/pagos", path: "/payments/pagos", ownId: I.paymentA, foreignId: I.paymentB },
    { label: "pagos-cliente", path: "/pagos-cliente", ownId: I.paymentA, foreignId: I.paymentB },
    { label: "pagos alias", path: "/pagos", ownId: I.paymentA, foreignId: I.paymentB },
    { label: "payments/detalles", path: "/payments/detalles-pago", ownId: I.detailA, foreignId: I.detailB },
    { label: "detalles-pago", path: "/detalles-pago", ownId: I.detailA, foreignId: I.detailB },
  ];

  const deniedReads: Probe[] = [
    { label: "gym B", path: `/gyms/${I.gymB}`, foreignId: I.gymB },
    { label: "user B", path: `/users/${I.userB}`, foreignId: I.userB },
    { label: "catalog horario B", path: `/catalogs/horarios/${I.horarioB}`, foreignId: I.horarioB },
    { label: "horario B", path: `/horarios/${I.horarioB}`, foreignId: I.horarioB },
    { label: "catalog plan B", path: `/catalogs/planes-pago/${I.planB}`, foreignId: I.planB },
    { label: "plan B", path: `/planes-pago/${I.planB}`, foreignId: I.planB },
    { label: "catalog cuenta B", path: `/catalogs/cuentas/${I.cuentaB}`, foreignId: I.cuentaB },
    { label: "cuenta B", path: `/cuentas/${I.cuentaB}`, foreignId: I.cuentaB },
    { label: "client alias B", path: `/clients/clientes/${I.clientB}`, foreignId: I.clientB },
    { label: "cliente B", path: `/clientes/${I.clientB}`, foreignId: I.clientB },
    { label: "trainer alias B", path: `/trainers/entrenadores/${I.trainerB}`, foreignId: I.trainerB },
    { label: "entrenador B", path: `/entrenadores/${I.trainerB}`, foreignId: I.trainerB },
    { label: "weight alias B", path: `/clients/pesos/${I.weightB}`, foreignId: I.weightB },
    { label: "peso B", path: `/cliente-pesos/${I.weightB}`, foreignId: I.weightB },
    { label: "attendance alias B", path: `/clients/asistencias/${I.attendanceB}`, foreignId: I.attendanceB },
    { label: "asistencia B", path: `/asistencias/${I.attendanceB}`, foreignId: I.attendanceB },
    { label: "legacy payment B", path: `/payments/pagos/${I.paymentB}`, foreignId: I.paymentB },
    { label: "payment B", path: `/pagos-cliente/${I.paymentB}`, foreignId: I.paymentB },
    { label: "payment alias B", path: `/pagos/${I.paymentB}`, foreignId: I.paymentB },
    { label: "legacy detail B", path: `/payments/detalles-pago/${I.detailB}`, foreignId: I.detailB },
    { label: "detail B", path: `/detalles-pago/${I.detailB}`, foreignId: I.detailB },
  ];

  for (const probe of listProbes) await runListProbe(tokenA, probe);
  for (const probe of deniedReads) await runDeniedProbe(tokenA, probe);

  const mutations = [
    ["gym", `/gyms/${I.gymB}`, { nombre: "INTRUSION" }],
    ["user", `/users/${I.userB}`, { user_nombre: "INTRUSION" }],
    ["horario", `/horarios/${I.horarioB}`, { nombre_horario: "INTRUSION" }],
    ["plan", `/planes-pago/${I.planB}`, { nombre_plan_pago: "INTRUSION" }],
    ["cuenta", `/cuentas/${I.cuentaB}`, { nombre_cuenta: "INTRUSION" }],
    ["entrenador", `/entrenadores/${I.trainerB}`, { nombres_entrenador: "INTRUSION" }],
    ["cliente", `/clientes/${I.clientB}`, { nombres: "INTRUSION" }],
    ["peso", `/cliente-pesos/${I.weightB}`, { peso: 999 }],
    ["asistencia", `/asistencias/${I.attendanceB}`, { fecha_salida: "2026-07-22T17:00:00.000Z" }],
  ] as const;
  for (const [label, path, body] of mutations) {
    const result = await request(tokenA, path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (result.status !== 404) {
      fail(`mutación ${label}: esperaba 404 y obtuvo ${result.status}; body=${result.body}`);
    }
  }

  const deletePayment = await request(tokenA, `/pagos-cliente/${I.paymentB}`, {
    method: "DELETE",
  });
  if (deletePayment.status !== 404) {
    fail(`baja de pago ajeno: esperaba 404 y obtuvo ${deletePayment.status}`);
  }

  const foreign = await Promise.all([
    prisma.gym.findUnique({ where: { gym_id: I.gymB }, select: { nombre: true } }),
    prisma.user.findUnique({ where: { user_id: I.userB }, select: { user_nombre: true } }),
    prisma.horario.findUnique({ where: { horario_id: I.horarioB }, select: { nombre_horario: true } }),
    prisma.planesPago.findUnique({ where: { id_planes_pago: I.planB }, select: { nombre_plan_pago: true } }),
    prisma.cuenta.findUnique({ where: { cuenta_id: I.cuentaB }, select: { nombre_cuenta: true } }),
    prisma.entrenador.findUnique({ where: { id_entrenador: I.trainerB }, select: { nombres_entrenador: true } }),
    prisma.cliente.findUnique({ where: { ci: I.clientB }, select: { nombres: true } }),
    prisma.clientePeso.findUnique({ where: { cliente_peso_id: I.weightB }, select: { peso: true } }),
    prisma.asistencia.findUnique({ where: { asistencia_id: I.attendanceB }, select: { fecha_salida: true } }),
    prisma.pagoCliente.findUnique({ where: { pago_cliente_id: I.paymentB }, select: { is_deleted: true } }),
  ]);
  const foreignSnapshot = JSON.stringify(foreign);
  if (foreignSnapshot.includes("INTRUSION") || !foreignSnapshot.includes("81.7")) {
    fail(`la sede B fue modificada: ${foreignSnapshot}`);
  }

  const crossTenantReferences = [
    [prisma.cliente, "cliente", "ci", I.clientB],
    [prisma.planesPago, "plan", "id_planes_pago", I.planB],
    [prisma.entrenador, "entrenador", "id_entrenador", I.trainerB],
    [prisma.cuenta, "cuenta", "cuenta_id", I.cuentaB],
    [prisma.pagoCliente, "pago", "pago_cliente_id", I.paymentB],
  ] as const;
  for (const [delegate, entity, pk, id] of crossTenantReferences) {
    let denied = false;
    try {
      await assertGymScopedReference({ delegate, entity, pk, id, gymId: I.gymA });
    } catch {
      denied = true;
    }
    if (!denied) fail(`la relación ${entity} ajena fue aceptada`);
  }

  await prisma.user.update({ where: { user_id: I.userA }, data: { active: false } });
  try {
    for (const path of ["/gyms", "/contabilidad/summary"]) {
      const revoked = await request(tokenA, path);
      if (revoked.status !== 403) {
        fail(`JWT revocado en ${path}: esperaba 403 y obtuvo ${revoked.status}`);
      }
    }
  } finally {
    await prisma.user.update({ where: { user_id: I.userA }, data: { active: true } });
  }

  const syncAfter = await prisma.syncLog.count();
  if (syncAfter !== syncBefore) {
    fail(`la fixture/prueba alteró sync_log: ${syncBefore} -> ${syncAfter}`);
  }

  console.log(JSON.stringify({
    result: "PASS",
    database: "MariaDB remota",
    fixture: "demo-tenant-isolation-v1 (double-install, retained)",
    fixture_gate: { deterministic_memberships: memberships.length },
    actor_gym: I.gymA,
    foreign_gym: I.gymB,
    checks: {
      isolated_lists: listProbes.length,
      denied_foreign_reads: deniedReads.length,
      denied_foreign_mutations: mutations.length + 1,
      revoked_valid_jwt_routes: 2,
      foreign_rows_unchanged: foreign.length,
      denied_cross_tenant_references: crossTenantReferences.length,
      total: listProbes.length + deniedReads.length + mutations.length + 18,
    },
    sync_log: { before: syncBefore, after: syncAfter, delta: 0 },
  }, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
