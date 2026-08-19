/**
 * M6 — firmar el consolidado de la cadena (docs/MULTI_SEDE.md §6.4).
 *
 * El informe agregado se mira cuando se quiera y cambia si llegan datos nuevos.
 * Esto lo congela: guarda la foto exacta y su sello, y a partir de ahí «esto es
 * lo que se cerró en julio» se puede demostrar aunque después entren
 * correcciones.
 *
 * ## Firmar dos veces no pisa lo firmado
 *
 * Un período puede necesitar un certificado nuevo —una sede reabrió y volvió a
 * cerrar, llegó un cobro que faltaba—. Ese caso **no** actualiza el certificado
 * anterior: emite el ciclo siguiente y deja el viejo en la tabla, anulado con su
 * motivo. Sobrescribirlo destruiría justo lo que el certificado existe para
 * conservar, y quien mirara la foto de julio vería la corrección de agosto sin
 * enterarse.
 *
 * `clave_activa` deja uno solo vigente; los anulados la sueltan y siguen ahí.
 *
 * ## El certificado viaja a todas las sedes
 *
 * Se emite con `gym_id: null`, como la solicitud de cierre y el precio del plus:
 * es de la cadena, y la sede tiene derecho a ver la foto contable en la que
 * entró. Además la paridad de datos lo exige: un dato que solo existe en el
 * concentrador es una divergencia esperando turno.
 */
import { createHash, randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";
import {
  certificadoIntacto,
  firmarConsolidado,
  motivoParaNoCertificar,
  CertificadoCadenaError,
  type ActorQueFirma,
} from "../../domain/certificado-cadena-policy";
import { consolidadoDeLaCadena } from "./consolidado-cadena.service";
import type { PeriodoDelSemaforo } from "./semaforo-cierre.service";

export { CertificadoCadenaError };

export const ESTADO_VIGENTE = "VIGENTE";
export const ESTADO_ANULADO = "ANULADO";

/** Clave del período: es lo que impide dos certificados vigentes del mismo mes. */
export function claveDelPeriodo(periodo: PeriodoDelSemaforo, tipoPeriodo: string): string {
  return [
    String(tipoPeriodo ?? "").trim().toUpperCase() || "RANGO",
    periodo.fechaInicio.toISOString(),
    periodo.fechaFinExclusiva.toISOString(),
  ].join("|");
}

/** Identidad derivada del período **y del ciclo**: rehacer no pisa. */
export function certificadoIdDe(clave: string, ciclo: number): string {
  return `ccc-${createHash("sha256").update(`${clave}|${ciclo}`).digest("hex").slice(0, 32)}`;
}

const publico = (fila: any) =>
  fila && {
    certificado_id: fila.certificado_id,
    tipo_periodo: fila.tipo_periodo,
    fecha_inicio: fila.fecha_inicio,
    fecha_fin_exclusiva: fila.fecha_fin_exclusiva,
    ciclo_numero: fila.ciclo_numero,
    clase: fila.clase,
    estado: fila.estado,
    sedes_incluidas: fila.sedes_incluidas,
    foto_sha256: fila.foto_sha256,
    foto_version: fila.foto_version,
    firmado_por: fila.firmado_por_nombre_snapshot,
    firmado_at: fila.firmado_at,
    anulado_motivo: fila.anulado_motivo,
    anulado_at: fila.anulado_at,
    // La foto se devuelve tal cual se selló, para que quien la reciba pueda
    // comprobar el sello sin volver a serializarla.
    foto_json: fila.foto_json,
  };

/**
 * Firma el consolidado del período.
 *
 * `motivo` es obligatorio cuando ya había uno vigente: rehacer un certificado es
 * una decisión contable y tiene que quedar dicho por qué, en la fila que se
 * anula.
 */
export async function firmarCertificadoDeCadena(input: {
  readonly periodo: PeriodoDelSemaforo;
  readonly tipoPeriodo: string;
  readonly actor: ActorQueFirma;
  readonly motivo?: unknown;
  readonly sourceDevice: string;
  readonly ahora?: Date;
}) {
  const ahora = input.ahora ?? trustedClock.nowUtc();
  const informe = await consolidadoDeLaCadena({ periodo: input.periodo, ahora });

  const consolidado = {
    clase: informe.clase,
    monedas: informe.monedas.map((bloque) => ({
      monedaId: bloque.moneda_id,
      monedaCodigo: bloque.moneda_codigo,
      ingresoMenor: bloque.ingreso_menor,
      cobradoPorCuentaAjenaMenor: bloque.cobrado_cuenta_ajena_menor,
      sedes: bloque.sedes.map((sede) => ({
        gymId: sede.gym_id,
        ingresoMenor: sede.ingreso_menor,
        cobradoPorCuentaAjenaMenor: sede.cobrado_cuenta_ajena_menor,
        origenCierre: sede.origen_cierre,
      })),
    })),
    ausentes: informe.ausentes.map((sede) => ({ gymId: sede.gym_id, motivo: sede.motivo })),
    sedesIncluidas: informe.sedes_incluidas,
    avisos: informe.avisos,
  };

  const impedimento = motivoParaNoCertificar(consolidado);
  if (impedimento) throw new CertificadoCadenaError(impedimento, 409);

  const clave = claveDelPeriodo(input.periodo, input.tipoPeriodo);
  const motivo = String(input.motivo ?? "").trim();

  return prisma.$transaction(async (tx) => {
    const vigente = await tx.cierreCadenaCertificado.findFirst({
      where: { clave_activa: clave, is_deleted: false },
    });
    if (vigente && !motivo) {
      throw new CertificadoCadenaError(
        "Ese período ya tiene un certificado vigente. Rehacerlo exige decir por qué.",
        409,
      );
    }

    const ultimo = await tx.cierreCadenaCertificado.findFirst({
      where: { tipo_periodo: input.tipoPeriodo, fecha_inicio: input.periodo.fechaInicio },
      orderBy: { ciclo_numero: "desc" },
      select: { ciclo_numero: true },
    });
    const ciclo = (ultimo?.ciclo_numero ?? 0) + 1;

    if (vigente) {
      // Suelta la clave y se queda: el histórico es la razón de ser de la tabla.
      const anulado = await tx.cierreCadenaCertificado.update({
        where: { certificado_id: vigente.certificado_id },
        data: {
          clave_activa: null,
          estado: ESTADO_ANULADO,
          anulado_motivo: motivo,
          anulado_at: ahora,
          version: { increment: 1 },
          updated_at: ahora,
        },
      });
      await registrarEvento(tx, anulado.certificado_id, "UPDATE", anulado);
    }

    const firmado = firmarConsolidado({
      consolidado,
      periodo: {
        tipoPeriodo: input.tipoPeriodo,
        fechaInicio: input.periodo.fechaInicio,
        fechaFinExclusiva: input.periodo.fechaFinExclusiva,
      },
      actor: input.actor,
      ahora,
    });

    const fila = await tx.cierreCadenaCertificado.create({
      data: {
        certificado_id: certificadoIdDe(clave, ciclo),
        clave_activa: clave,
        tipo_periodo: firmado.foto.periodo.tipo,
        fecha_inicio: input.periodo.fechaInicio,
        fecha_fin_exclusiva: input.periodo.fechaFinExclusiva,
        ciclo_numero: ciclo,
        clase: firmado.foto.clase,
        estado: ESTADO_VIGENTE,
        sedes_incluidas: firmado.foto.sedesIncluidas,
        // El texto exacto que se selló, no una re-serialización.
        foto_json: firmado.textoFirmado,
        foto_sha256: firmado.sha256,
        foto_version: firmado.foto.version,
        firmado_por_user_id: firmado.foto.firmadoPor.userId,
        firmado_por_nombre_snapshot: firmado.foto.firmadoPor.nombre,
        firmado_por_rol_snapshot: firmado.foto.firmadoPor.rol,
        firmado_at: ahora,
        source_device: input.sourceDevice,
        is_deleted: false,
        created_at: ahora,
        updated_at: ahora,
        version: 1,
      },
    });
    await registrarEvento(tx, fila.certificado_id, "INSERT", fila);
    return { certificado: publico(fila), rehecho: Boolean(vigente) };
  });
}

/** Los certificados de la cadena, el vigente primero. */
export async function listarCertificados(input: { readonly soloVigentes: boolean }) {
  const filas = await prisma.cierreCadenaCertificado.findMany({
    where: {
      is_deleted: false,
      ...(input.soloVigentes ? { estado: ESTADO_VIGENTE } : {}),
    },
    orderBy: [{ fecha_inicio: "desc" }, { ciclo_numero: "desc" }],
    take: 100,
  });
  return filas.map((fila) => ({
    ...publico(fila),
    // Se comprueba al leer y no solo al firmar: un sello que solo se mira el día
    // que se pone no protege de nada.
    integro: certificadoIntacto({ textoFirmado: fila.foto_json, sha256: fila.foto_sha256 }),
  }));
}

/**
 * El evento nace **sin sede** para que llegue a todas las instalaciones, igual
 * que la solicitud de cierre.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function registrarEvento(tx: any, entidadId: string, operacion: string, fila: any) {
  await tx.syncLog.create({
    data: {
      event_id: randomUUID(),
      entidad: "cierre_cadena_certificado",
      operacion,
      entidad_id: entidadId,
      gym_id: null,
      device_id: null,
      payload_json: JSON.stringify(fila),
    },
  });
}
