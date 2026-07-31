/**
 * Verificación reproducible y de solo lectura de R6 remoto.
 *
 * Usa la aplicación Hono productiva, una sesión real revalidada y filas ya
 * instaladas por `scripts/simular-negocio.ts`. No levanta puerto, no crea datos
 * y no toca sincronización.
 */
import { app } from "../src/infrastructure/http/server";
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { prisma } from "../src/infrastructure/db/prismaClient";

interface Target {
  kind: "socio" | "entrenador" | "plan";
  path: string;
  requiredSections: string[];
}

async function main() {
  const sede = await prisma.usuarioSede.findFirst({
    where: { activo: true, is_deleted: false },
    orderBy: [{ gym_id: "asc" }, { user_id: "asc" }],
    select: { user_id: true, gym_id: true, rol: true },
  });
  if (!sede) throw new Error("No hay una asignación usuario-sede activa.");

  const user = await prisma.user.findFirst({
    where: {
      user_id: sede.user_id,
      active: true,
      is_deleted: false,
    },
    select: { user_id: true },
  });
  if (!user) throw new Error("La asignación no tiene un usuario activo.");

  const [socio, entrenador, plan] = await Promise.all([
    prisma.cliente.findFirst({
      where: { gym_id: sede.gym_id, is_deleted: false },
      orderBy: { ci: "asc" },
      select: { ci: true },
    }),
    prisma.entrenador.findFirst({
      where: { gym_id: sede.gym_id, is_deleted: false },
      orderBy: { id_entrenador: "asc" },
      select: { id_entrenador: true },
    }),
    prisma.planesPago.findFirst({
      where: { gym_id: sede.gym_id, is_deleted: false },
      orderBy: { id_planes_pago: "asc" },
      select: { id_planes_pago: true },
    }),
  ]);
  if (!socio || !entrenador || !plan) {
    throw new Error(
      "La fixture no contiene socio, entrenador y plan para verificar R6.",
    );
  }

  const token = JwtService.signAdminToken({
    userId: user.user_id,
    role: sede.rol,
    gymId: sede.gym_id,
  });
  const targets: Target[] = [
    {
      kind: "socio",
      path: `/estadisticas/socio/${encodeURIComponent(socio.ci)}`,
      requiredSections: ["socio", "constancia", "dinero", "contrato", "cuerpo"],
    },
    {
      kind: "entrenador",
      path:
        `/estadisticas/entrenador/` +
        encodeURIComponent(entrenador.id_entrenador),
      requiredSections: [
        "entrenador",
        "cartera",
        "composicion",
        "constancia",
        "retencion",
        "ingresos",
      ],
    },
    {
      kind: "plan",
      path: `/estadisticas/plan/${encodeURIComponent(plan.id_planes_pago)}`,
      requiredSections: [
        "plan",
        "contratacion",
        "composicion",
        "movilidad",
        "dinero",
        "duracion",
        "uso",
        "cuotas",
      ],
    },
  ];

  const results: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    const started = performance.now();
    const response = await app.request(target.path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = await response.json();
    const body =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
    const missing = target.requiredSections.filter(
      (section) => !(section in body),
    );
    if (response.status !== 200 || missing.length > 0) {
      throw new Error(
        `${target.kind}: HTTP ${response.status}; faltan ${missing.join(", ")}`,
      );
    }
    results.push({
      perfil: target.kind,
      status: response.status,
      ms: Math.round(performance.now() - started),
      zona: body.zona,
      dia_negocio: body.dia_negocio,
      secciones: target.requiredSections,
    });
  }

  console.log(
    JSON.stringify(
      {
        estado: "PASS",
        gym_id: sede.gym_id,
        solo_lectura: true,
        resultados: results,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
