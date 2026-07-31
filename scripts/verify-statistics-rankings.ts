import { trustedClock } from "../src/config/trusted-clock";
import { datePartsInZone } from "../src/config/tz";
import { EstadisticasRankingsService } from "../src/application/reporting/estadisticas-rankings.service";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { PrismaEstadisticasRankingsReader } from "../src/infrastructure/repositories/prisma-estadisticas-rankings.reader";
import { DEMO_R6_GYM_ID } from "../../scripts/demo-r6-rankings";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_R6_GYM_ID;
try {
  const gym = await prisma.gym.findUnique({
    where: { gym_id: gymId },
    select: { timezone: true },
  });
  if (!gym?.timezone) throw new Error("La sede demo no tiene timezone.");
  const zona = gym.timezone;
  const parts = datePartsInZone(zona, trustedClock.nowUtc());
  const hoy = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const reader = new PrismaEstadisticasRankingsReader();
  const service = new EstadisticasRankingsService(reader);
  const result = await service.portada({
    gymId,
    zona,
    hoy,
    dias: 90,
    limite: 10,
  });
  const monedaId = result.socios.porValor[0]?.monedaId;
  const consultas = await Promise.all([
    service.ranking({
      gymId, zona, hoy, tipo: "planes", dias: 90,
      pagina: 1, tamano: 2, orden: "vendidos",
    }),
    service.ranking({
      gymId, zona, hoy, tipo: "entrenadores", dias: 90,
      pagina: 1, tamano: 2, orden: "carteraActiva",
    }),
    service.ranking({
      gymId, zona, hoy, tipo: "entrenadores", dias: 90,
      pagina: 2, tamano: 2, orden: "carteraActiva",
    }),
    service.ranking({
      gymId, zona, hoy, tipo: "socios-visitas", dias: 90,
      pagina: 1, tamano: 2, orden: "visitas",
    }),
    service.ranking({
      gymId, zona, hoy, tipo: "socios-inactividad", dias: 90,
      pagina: 1, tamano: 2, orden: "diasSinVisita",
    }),
    service.ranking({
      gymId, zona, hoy, tipo: "socios-cambios-entrenador",
      dias: 90, pagina: 1, tamano: 2, busqueda: "Mateo",
    }),
    monedaId
      ? service.ranking({
        gymId, zona, hoy, tipo: "socios-valor", dias: 90,
        pagina: 1, tamano: 2, monedaId,
      })
      : Promise.resolve(null),
    service.ranking({
      gymId, zona, hoy, tipo: "socios-visitas", dias: 90,
      pagina: 1, tamano: 10, busqueda: "Demo", orden: "visitas",
    }),
    monedaId
      ? service.ranking({
        gymId, zona, hoy, tipo: "socios-valor", dias: 90,
        pagina: 1, tamano: 10, busqueda: "Demo", monedaId,
      })
      : Promise.resolve(null),
  ]);
  const csv = await service.exportarCsv({
    gymId,
    zona,
    hoy,
    tipo: "socios-visitas",
    dias: 90,
    busqueda: "Demo",
    orden: "visitas",
    direccion: "desc",
  });
  const csvLineas = csv.contenido.replace(/^\uFEFF/, "").split("\r\n");
  const pagina = (value: Awaited<ReturnType<typeof service.ranking>> | null) =>
    value == null ? null : ({
      tipo: value.tipo,
      pagina: value.pagina,
      busqueda: value.busqueda,
      orden: value.orden,
      filas: value.filas,
    });
  console.log(JSON.stringify({
    base: "MariaDB",
    periodo: result.periodo,
    periodoAnterior: result.periodoAnterior,
    limites: {
      planes: result.planes.length,
      entrenadores: result.entrenadores.length,
      visitas: result.socios.porVisitas.length,
      inactividad: result.socios.porInactividad.length,
      cambiosEntrenador: result.socios.porCambiosEntrenador.length,
    },
    alertas: {
      disparadas: result.alertas,
      omitidas: result.alertasOmitidas,
      reglasEvaluadas: result.reglasAlerta.map((regla) => regla.familia),
    },
    demoPlanes: result.planes.filter((row) => row.nombre.includes("(demo)")),
    demoEntrenadores: result.entrenadores.filter((row) => row.nombre.includes("Cartera Demo")),
    topSocios: result.socios.porVisitas,
    cambioMateo: result.socios.porCambiosEntrenador.find((row) => row.nombre.includes("Mateo")),
    explorador: {
      planes: pagina(consultas[0]),
      entrenadoresPagina1: pagina(consultas[1]),
      entrenadoresPagina2: pagina(consultas[2]),
      visitas: pagina(consultas[3]),
      inactividad: pagina(consultas[4]),
      buscarMateo: pagina(consultas[5]),
      valor: pagina(consultas[6]),
      visitasDemo: pagina(consultas[7]),
      valorDemo: pagina(consultas[8]),
    },
    exportacionCsv: {
      nombreArchivo: csv.nombreArchivo,
      total: csv.total,
      bomUtf8: csv.contenido.startsWith("\uFEFF"),
      cabecera: csvLineas[0],
      filas: csvLineas.slice(1),
    },
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
