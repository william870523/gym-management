/**
 * M6 — el certificado del consolidado de la cadena (docs/MULTI_SEDE.md §6.4).
 *
 * §6.4 separa dos cosas que se confunden con facilidad: el **informe agregado**,
 * que se mira cuando se quiera y cambia si llegan datos nuevos, y el
 * **certificado firmado**, que «guarda una copia exacta de lo que había en ese
 * momento y ya no cambia aunque después entren correcciones». Sirve para poder
 * decir «esto es lo que se cerró en julio» y que nadie pueda reescribirlo.
 *
 * Este fichero congela esa foto y la sella. No decide cifras —las trae el
 * consolidado— ni habla con la base.
 *
 * ## Por qué la serialización es canónica, y por qué eso importa aquí
 *
 * El sello es un `sha256` del texto de la foto. Dos serializaciones distintas
 * del **mismo** contenido —claves en otro orden, un espacio de más— dan hashes
 * distintos. Como este fichero es gemelo byte a byte en las dos APIs, si cada
 * una serializara a su manera pasaría lo peor que le puede pasar a un
 * certificado: verificarlo en la base equivocada diría que **fue manipulado**
 * cuando lo único que cambió fue el orden de las claves. Una alarma de integridad
 * que salta sin motivo se aprende a ignorar, y entonces deja de proteger.
 *
 * Por eso las claves se ordenan siempre, los importes viajan como enteros de
 * unidades menores —nada de decimales flotantes— y las fechas como texto ISO.
 *
 * ## Qué se puede firmar
 *
 * Un consolidado **parcial** sí se firma: §6.2 punto 5 lo permite siempre que
 * nombre a las sedes ausentes, y por eso la lista viaja **dentro** de la foto y
 * no al lado. Lo que no se firma nunca es un consolidado vacío: un certificado
 * sin un solo cierre dentro no congela nada y después parecería que el período
 * se cerró.
 */
import { createHash } from "crypto";

/** Lo que el certificado necesita saber de quién firma. */
export interface ActorQueFirma {
  readonly userId: string;
  readonly nombre: string;
  readonly rol: string;
}

export interface PeriodoCertificado {
  readonly tipoPeriodo: string;
  readonly fechaInicio: Date;
  readonly fechaFinExclusiva: Date;
}

/** El consolidado, tal y como lo publica su política. */
export interface ConsolidadoParaFirmar {
  readonly clase: "COMPLETO" | "PARCIAL_DECLARADO";
  readonly monedas: readonly {
    readonly monedaId: string;
    readonly monedaCodigo?: string | null;
    readonly ingresoMenor: number;
    readonly cobradoPorCuentaAjenaMenor: number;
    readonly sedes: readonly {
      readonly gymId: string;
      readonly ingresoMenor: number;
      readonly cobradoPorCuentaAjenaMenor: number;
      readonly origenCierre: string;
    }[];
  }[];
  readonly ausentes: readonly { readonly gymId: string; readonly motivo: string }[];
  readonly sedesIncluidas: number;
  /** Lo que los cierres incluidos no pueden afirmar. Entra en la foto. */
  readonly avisos?: readonly string[];
}

export class CertificadoCadenaError extends Error {
  /** Código HTTP que le corresponde en el borde, para no traducirlo dos veces. */
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

const fecha = (valor: Date) => valor.toISOString();
const entero = (valor: unknown) => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * Texto canónico de un valor: claves ordenadas y sin espacios de adorno.
 *
 * Se escribe aquí y no se toma de una utilidad compartida a propósito: el sello
 * de un certificado no puede depender de que dos proyectos mantengan
 * sincronizada una dependencia. Si esta función cambia, cambia el hash de todo
 * lo que se firme después —lo anterior sigue verificándose contra su propia
 * versión, que viaja en la foto—.
 */
export function textoCanonico(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (Array.isArray(valor)) return `[${valor.map(textoCanonico).join(",")}]`;
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  if (typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([izquierda], [derecha]) => (izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0));
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${textoCanonico(v)}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

/** Versión del formato de la foto. Viaja dentro para poder verificarla después. */
export const VERSION_CERTIFICADO = 1;

export interface FotoDelCertificado {
  readonly version: number;
  readonly clase: "COMPLETO" | "PARCIAL_DECLARADO";
  readonly periodo: {
    readonly tipo: string;
    readonly desde: string;
    readonly hastaExclusiva: string;
  };
  readonly firmadoPor: { readonly userId: string; readonly nombre: string; readonly rol: string };
  readonly firmadoAt: string;
  readonly monedas: readonly unknown[];
  readonly ausentes: readonly unknown[];
  readonly sedesIncluidas: number;
  readonly avisos: readonly string[];
}

export interface CertificadoFirmado {
  readonly foto: FotoDelCertificado;
  /** El texto exacto que se selló. Es lo que se guarda, no una re-serialización. */
  readonly textoFirmado: string;
  readonly sha256: string;
}

/**
 * Congela el consolidado en una foto y la sella.
 *
 * El texto sellado se devuelve junto al hash **a propósito**: guardar la foto y
 * volver a serializarla al verificar es la manera de que un cambio inocente en
 * la serialización invalide certificados viejos. Se guarda el texto tal cual se
 * selló, y verificar es volver a pasarle el hash.
 */
export function firmarConsolidado(input: {
  readonly consolidado: ConsolidadoParaFirmar;
  readonly periodo: PeriodoCertificado;
  readonly actor: ActorQueFirma;
  readonly ahora: Date;
}): CertificadoFirmado {
  const { consolidado, periodo, actor } = input;
  const motivo = motivoParaNoCertificar(consolidado);
  if (motivo) throw new CertificadoCadenaError(motivo);
  if (!String(actor.userId ?? "").trim()) {
    // Un certificado sin autor no se puede auditar, y firmar es justamente el
    // acto que necesita saber quién lo hizo.
    throw new CertificadoCadenaError("Un certificado exige saber quién lo firma.");
  }

  const foto: FotoDelCertificado = {
    version: VERSION_CERTIFICADO,
    clase: consolidado.clase,
    periodo: {
      tipo: String(periodo.tipoPeriodo ?? "").trim().toUpperCase() || "RANGO",
      desde: fecha(periodo.fechaInicio),
      hastaExclusiva: fecha(periodo.fechaFinExclusiva),
    },
    firmadoPor: {
      userId: String(actor.userId).trim(),
      nombre: String(actor.nombre ?? "").trim() || String(actor.userId).trim(),
      rol: String(actor.rol ?? "").trim() || "user",
    },
    firmadoAt: fecha(input.ahora),
    monedas: consolidado.monedas.map((bloque) => ({
      monedaId: bloque.monedaId,
      monedaCodigo: bloque.monedaCodigo ?? bloque.monedaId,
      ingresoMenor: entero(bloque.ingresoMenor),
      cobradoPorCuentaAjenaMenor: entero(bloque.cobradoPorCuentaAjenaMenor),
      sedes: bloque.sedes.map((sede) => ({
        gymId: sede.gymId,
        ingresoMenor: entero(sede.ingresoMenor),
        cobradoPorCuentaAjenaMenor: entero(sede.cobradoPorCuentaAjenaMenor),
        origenCierre: sede.origenCierre,
      })),
    })),
    // Las ausentes van DENTRO de la foto, no al lado: un parcial que se firme y
    // pierda por el camino a quién dejó fuera es exactamente el «total
    // silencioso e incompleto» que §6.2 prohíbe.
    ausentes: consolidado.ausentes.map((sede) => ({
      gymId: sede.gymId,
      motivo: sede.motivo,
    })),
    sedesIncluidas: entero(consolidado.sedesIncluidas),
    // También los avisos: si un cierre incluido no distinguía el dinero cobrado
    // por cuenta ajena, el certificado tiene que seguir diciéndolo dentro de un
    // año, cuando ya nadie recuerde por qué.
    avisos: [...(consolidado.avisos ?? [])],
  };

  const textoFirmado = textoCanonico(foto);
  return {
    foto,
    textoFirmado,
    sha256: createHash("sha256").update(textoFirmado).digest("hex"),
  };
}

/** Por qué este consolidado no se puede certificar, o `null` si se puede. */
export function motivoParaNoCertificar(consolidado: ConsolidadoParaFirmar): string | null {
  if (entero(consolidado.sedesIncluidas) === 0) {
    return "Ninguna sede ha firmado su cierre: no hay nada que congelar.";
  }
  if (consolidado.monedas.length === 0) {
    return "Los cierres incluidos no traen ninguna moneda con movimiento.";
  }
  if (consolidado.clase === "PARCIAL_DECLARADO" && consolidado.ausentes.length === 0) {
    // Contradicción: parcial es, por definición, «faltan estas». Sin lista, el
    // certificado no podría declarar lo que dice ser.
    return "Un cierre parcial tiene que nombrar a las sedes que deja fuera.";
  }
  return null;
}

/**
 * Verifica un certificado guardado contra su sello.
 *
 * Recibe el **texto** que se firmó, no la foto reconstruida: es lo único que
 * demuestra que nadie la tocó. Si se volviera a serializar desde los campos, la
 * verificación pasaría a medir la serialización de hoy y no la firma de
 * entonces.
 */
export function certificadoIntacto(input: {
  readonly textoFirmado: string;
  readonly sha256: string;
}): boolean {
  const calculado = createHash("sha256").update(input.textoFirmado ?? "").digest("hex");
  return calculado === String(input.sha256 ?? "").trim().toLowerCase();
}
