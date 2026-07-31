import { Hono } from "hono";
import { trustedClock } from "../../../config/trusted-clock";
import {
  datePartsInZone,
  isValidTimeZone,
} from "../../../config/tz";
import { logger } from "../../../config/logger";
import { EstadisticasSocioService } from "../../../application/reporting/estadisticas-socio.service";
import { EstadisticasEntrenadorService } from "../../../application/reporting/estadisticas-entrenador.service";
import { EstadisticasPlanService } from "../../../application/reporting/estadisticas-plan.service";
import {
  ConsultaRankingInvalida,
  EstadisticasRankingsService,
  PERIODOS_RANKINGS,
  type PeriodoRankings,
} from "../../../application/reporting/estadisticas-rankings.service";
import { prisma } from "../../db/prismaClient";
import { PrismaEstadisticasSocioReader } from "../../repositories/prisma-estadisticas-socio.reader";
import { PrismaEstadisticasEntrenadorReader } from "../../repositories/prisma-estadisticas-entrenador.reader";
import { PrismaEstadisticasPlanReader } from "../../repositories/prisma-estadisticas-plan.reader";
import { PrismaEstadisticasRankingsReader } from "../../repositories/prisma-estadisticas-rankings.reader";
import {
  ConsultaSegmentacionInvalida,
  EstadisticasSegmentacionService,
} from "../../../application/reporting/estadisticas-segmentacion.service";
import { PrismaEstadisticasSegmentacionReader } from "../../repositories/prisma-estadisticas-segmentacion.reader";
import {
  DEFINICIONES_MEDIDA,
  DIMENSIONES,
  MEDIDAS,
  TITULOS_DIMENSION,
} from "../../../application/reporting/estadisticas-segmentacion.reader";

const routes = new Hono();
const socioService = new EstadisticasSocioService(
  new PrismaEstadisticasSocioReader(),
);
const entrenadorService = new EstadisticasEntrenadorService(
  new PrismaEstadisticasEntrenadorReader(),
);
const planService = new EstadisticasPlanService(
  new PrismaEstadisticasPlanReader(),
);
const rankingsService = new EstadisticasRankingsService(
  new PrismaEstadisticasRankingsReader(),
);
const segmentacionService = new EstadisticasSegmentacionService(
  new PrismaEstadisticasSegmentacionReader(),
);

type UserAuth = {
  sub?: string;
  role?: string;
  gymId?: string;
};

function gymIdentity(c: any): string | null {
  const auth = c.get("auth") as UserAuth | undefined;
  if (!auth?.sub || !auth.gymId || auth.role === "device") return null;
  return auth.gymId;
}

async function contextoSede(gymId: string) {
  const gym = await prisma.gym.findFirst({
    where: { gym_id: gymId },
    select: { timezone: true },
  });
  const zona = gym?.timezone?.trim();
  if (!zona || !isValidTimeZone(zona)) {
    throw new Error("GYM_TIMEZONE_INVALID");
  }
  const partes = datePartsInZone(zona, trustedClock.nowUtc());
  return {
    zona,
    hoy: new Date(Date.UTC(partes.year, partes.month - 1, partes.day)),
  };
}

function fail(c: any, entity: string, error: unknown) {
  const gymId = gymIdentity(c);
  logger.error(`No se pudo calcular la estadística de ${entity}`, {
    gymId,
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error),
  });
  if (error instanceof Error && error.message === "GYM_TIMEZONE_INVALID") {
    return c.json(
      { error: "La sede no tiene una zona horaria válida configurada." },
      422,
    );
  }
  return c.json({ error: "No se pudo calcular la estadística." }, 500);
}

/**
 * Catálogo del cruzador (docs/PLAN_ESTADISTICAS.md §5). Gemelo del local: la
 * vista no se inventa la lista ni las definiciones, las lee de la misma fuente
 * que hace el cálculo.
 */
routes.get("/segmentacion/catalogo", (c) => {
  if (!gymIdentity(c)) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  return c.json({
    dimensiones: DIMENSIONES.map((dimension) => ({
      dimension,
      titulo: TITULOS_DIMENSION[dimension],
    })),
    medidas: MEDIDAS.map((medida) => ({
      medida,
      titulo: DEFINICIONES_MEDIDA[medida].titulo,
      dinero: DEFINICIONES_MEDIDA[medida].dinero,
      tasa: DEFINICIONES_MEDIDA[medida].tasa,
      ignoraPeriodo: DEFINICIONES_MEDIDA[medida].ignoraPeriodo,
      definicion: DEFINICIONES_MEDIDA[medida].definicion,
    })),
  });
});

routes.get("/segmentacion/csv", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    const exportacion = await segmentacionService.exportarCsv({
      gymId,
      zona,
      hoy,
      dimension: c.req.query("dimension") ?? "",
      medida: c.req.query("medida") ?? "",
      dias: Number(c.req.query("dias") ?? "90"),
      monedaId: c.req.query("moneda_id"),
    });
    return c.body(exportacion.contenido, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        `attachment; filename="${exportacion.nombreArchivo}"`,
      "X-Exported-Rows": String(exportacion.total),
    });
  } catch (error: unknown) {
    if (error instanceof ConsultaSegmentacionInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "segmentación (CSV)", error);
  }
});

routes.get("/segmentacion", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    return c.json(await segmentacionService.cruzar({
      gymId,
      zona,
      hoy,
      dimension: c.req.query("dimension") ?? "",
      medida: c.req.query("medida") ?? "",
      dias: Number(c.req.query("dias") ?? "90"),
      monedaId: c.req.query("moneda_id"),
    }));
  } catch (error: unknown) {
    if (error instanceof ConsultaSegmentacionInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "segmentación", error);
  }
});

routes.get("/rankings", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  const diasBrutos = Number(c.req.query("dias") ?? "90");
  if (!PERIODOS_RANKINGS.includes(diasBrutos as PeriodoRankings)) {
    return c.json({ error: "El período debe ser 30, 90 o 365 días." }, 400);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    return c.json(await rankingsService.portada({
      gymId,
      zona,
      hoy,
      dias: diasBrutos as PeriodoRankings,
    }));
  } catch (error) {
    return fail(c, "rankings", error);
  }
});

routes.get("/ranking/:tipo/csv", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    const exportacion = await rankingsService.exportarCsv({
      gymId,
      zona,
      hoy,
      tipo: c.req.param("tipo"),
      dias: Number(c.req.query("dias") ?? "90"),
      busqueda: c.req.query("q"),
      orden: c.req.query("orden"),
      direccion: c.req.query("direccion"),
      monedaId: c.req.query("moneda_id"),
    });
    return c.body(exportacion.contenido, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        `attachment; filename="${exportacion.nombreArchivo}"`,
      "X-Exported-Rows": String(exportacion.total),
    });
  } catch (error) {
    if (error instanceof ConsultaRankingInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "ranking CSV", error);
  }
});

routes.get("/ranking/:tipo", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    const pagina = c.req.query("pagina");
    const tamano = c.req.query("tamano");
    return c.json(await rankingsService.ranking({
      gymId,
      zona,
      hoy,
      tipo: c.req.param("tipo"),
      dias: Number(c.req.query("dias") ?? "90"),
      pagina: pagina == null ? undefined : Number(pagina),
      tamano: tamano == null ? undefined : Number(tamano),
      busqueda: c.req.query("q"),
      orden: c.req.query("orden"),
      direccion: c.req.query("direccion"),
      monedaId: c.req.query("moneda_id"),
    }));
  } catch (error) {
    if (error instanceof ConsultaRankingInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "ranking", error);
  }
});

routes.get("/socio/:ci", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    const perfil = await socioService.perfil({
      gymId,
      ci: c.req.param("ci"),
      zona,
      hoy,
    });
    if (!perfil) return c.json({ error: "Socio no encontrado." }, 404);
    return c.json({
      zona,
      dia_negocio: hoy.toISOString().slice(0, 10),
      ...perfil,
    });
  } catch (error) {
    return fail(c, "socio", error);
  }
});

routes.get("/entrenador/:id", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    const perfil = await entrenadorService.perfil({
      gymId,
      entrenadorId: c.req.param("id"),
      zona,
      hoy,
    });
    if (!perfil) return c.json({ error: "Entrenador no encontrado." }, 404);
    return c.json({
      zona,
      dia_negocio: hoy.toISOString().slice(0, 10),
      ...perfil,
    });
  } catch (error) {
    return fail(c, "entrenador", error);
  }
});

routes.get("/plan/:id", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    const perfil = await planService.perfil({
      gymId,
      planId: c.req.param("id"),
      zona,
      hoy,
    });
    if (!perfil) return c.json({ error: "Plan no encontrado." }, 404);
    return c.json({
      zona,
      dia_negocio: hoy.toISOString().slice(0, 10),
      ...perfil,
    });
  } catch (error) {
    return fail(c, "plan", error);
  }
});

export default routes;
