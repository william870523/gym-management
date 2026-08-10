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
  ConsultaCohortesInvalida,
  EstadisticasCohortesService,
} from "../../../application/reporting/estadisticas-cohortes.service";
import { PrismaEstadisticasCohortesReader } from "../../repositories/prisma-estadisticas-cohortes.reader";
import {
  ConsultaDemandaInvalida,
  EstadisticasDemandaService,
} from "../../../application/reporting/estadisticas-demanda.service";
import { PrismaEstadisticasDemandaReader } from "../../repositories/prisma-estadisticas-demanda.reader";
import {
  ConsultaCalidadInvalida,
  EstadisticasCalidadService,
} from "../../../application/reporting/estadisticas-calidad.service";
import { PrismaEstadisticasCalidadReader } from "../../repositories/prisma-estadisticas-calidad.reader";
import {
  ConsultaContabilidadGraficaInvalida,
  EstadisticasContabilidadService,
} from "../../../application/reporting/estadisticas-contabilidad.service";
import { PrismaEstadisticasContabilidadReader } from "../../repositories/prisma-estadisticas-contabilidad.reader";
import {
  ConsultaPronosticoInvalida,
  EstadisticasPronosticoService,
} from "../../../application/reporting/estadisticas-pronostico.service";
import { PrismaEstadisticasPronosticoReader } from "../../repositories/prisma-estadisticas-pronostico.reader";
import { TreasuryLedgerService } from "../../../application/accounting/treasury-ledger.service";
import { ManagementMarginService } from "../../../application/reporting/management-margin.service";
import { GovernedExpenseService } from "../../../application/reporting/governed-expense.service";
import { AccrualOperatingResultService } from "../../../application/reporting/accrual-operating-result.service";
import { ExchangeRevaluationService } from "../../../application/reporting/exchange-revaluation.service";
import { PrismaMembershipRevenueReader } from "../../reporting/prisma-membership-revenue.reader";
import { PrismaTrainerServiceCostReader } from "../../reporting/prisma-trainer-service-cost.reader";
import { PrismaManagementMarginMonthlyCloseReader } from "../../reporting/prisma-management-margin.reader";
import { PrismaGovernedExpenseReader } from "../../reporting/prisma-governed-expense.reader";
import { PrismaExchangeRevaluationReader } from "../../reporting/prisma-exchange-revaluation.reader";
import { RetencionCanonicaDesdeServicio } from "../../repositories/retencion-canonica.reader";
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
// Una sola traducción del motor canónico para todas las superficies que lo
// consultan: cruzador, portada, cohortes y calidad. Compartirla es lo que
// garantiza que ninguna pueda derivar una segunda fórmula de retención.
const retencionCanonica = new RetencionCanonicaDesdeServicio();
const rankingsService = new EstadisticasRankingsService(
  new PrismaEstadisticasRankingsReader(),
  retencionCanonica,
);
const segmentacionService = new EstadisticasSegmentacionService(
  new PrismaEstadisticasSegmentacionReader(),
  // Las bajas y la renovación las produce el motor canónico de retención,
  // no una consulta de la estadística (regla 11 del plan).
  retencionCanonica,
);
const cohortesService = new EstadisticasCohortesService(
  new PrismaEstadisticasCohortesReader(),
  retencionCanonica,
);
const demandaService = new EstadisticasDemandaService(
  new PrismaEstadisticasDemandaReader(),
);
const calidadService = new EstadisticasCalidadService(
  new PrismaEstadisticasCalidadReader(),
  retencionCanonica,
);
const treasuryLedger = new TreasuryLedgerService();
const managementMargin = new ManagementMarginService(
  new PrismaMembershipRevenueReader(),
  new PrismaTrainerServiceCostReader(),
  new PrismaManagementMarginMonthlyCloseReader(),
);
const governedExpenses = new GovernedExpenseService(new PrismaGovernedExpenseReader());
const accountingCharts = new EstadisticasContabilidadService(
  new PrismaEstadisticasContabilidadReader(),
  { get: ({ gymId, month }) => treasuryLedger.monthly(gymId, month) },
  new AccrualOperatingResultService(
    managementMargin,
    governedExpenses,
    new PrismaManagementMarginMonthlyCloseReader(),
  ),
  new ExchangeRevaluationService(new PrismaExchangeRevaluationReader()),
);
const forecastService = new EstadisticasPronosticoService(
  new PrismaEstadisticasPronosticoReader(),
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

function adminGymIdentity(c: any): string | null {
  const auth = c.get("auth") as UserAuth | undefined;
  return auth?.sub && auth.gymId && auth.role === "admin" ? auth.gymId : null;
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

/**
 * Cohortes de alta con retención a 30/60/90 días (§4.3).
 *
 * La supervivencia la decide el motor canónico de retención; aquí solo se
 * agrupa por el mes o la semana en que entró cada socio.
 */
routes.get("/cohortes", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    return c.json(await cohortesService.cohortes({
      gymId,
      zona,
      hoy,
      dias: Number(c.req.query("dias") ?? "365"),
      granularidad: c.req.query("granularidad") ?? "mes",
    }));
  } catch (error: unknown) {
    if (error instanceof ConsultaCohortesInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "cohortes de alta", error);
  }
});

/** Mapa de demanda observada día × hora (§5.2). Nunca porcentaje de ocupación. */
routes.get("/demanda", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    return c.json(await demandaService.demanda({
      gymId,
      zona,
      hoy,
      dias: Number(c.req.query("dias") ?? "90"),
    }));
  } catch (error: unknown) {
    if (error instanceof ConsultaDemandaInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "mapa de demanda", error);
  }
});

/** Panel de calidad de datos (§5.3). */
routes.get("/calidad", async (c) => {
  const gymId = gymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta de usuario del gimnasio." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    return c.json(await calidadService.calidad({
      gymId,
      zona,
      hoy,
      dias: Number(c.req.query("dias") ?? "90"),
    }));
  } catch (error: unknown) {
    if (error instanceof ConsultaCalidadInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "calidad de datos", error);
  }
});

/** E4: capa gráfica canónica; el gimnasio solo sale del JWT remoto. */
routes.get("/contabilidad", async (c) => {
  const gymId = adminGymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta administradora." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    return c.json(await accountingCharts.dashboard({
      gymId,
      zona,
      hoy,
      desde: c.req.query("desde"),
      hasta: c.req.query("hasta"),
    }));
  } catch (error: any) {
    if (error instanceof ConsultaContabilidadGraficaInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "contabilidad gráfica", error);
  }
});

/** E5: pronóstico explicable; la sede sale únicamente del JWT remoto. */
routes.get("/pronostico", async (c) => {
  const gymId = adminGymIdentity(c);
  if (!gymId) {
    return c.json({ error: "Se requiere una cuenta administradora." }, 403);
  }
  try {
    const { zona, hoy } = await contextoSede(gymId);
    return c.json(await forecastService.pronostico({
      gymId,
      zona,
      hoy,
      diasHistoria: Number(c.req.query("historia") ?? "180"),
      diasHorizonte: Number(c.req.query("horizonte") ?? "28"),
    }));
  } catch (error: unknown) {
    if (error instanceof ConsultaPronosticoInvalida) {
      return c.json({ error: error.message }, 400);
    }
    return fail(c, "pronóstico estadístico", error);
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
