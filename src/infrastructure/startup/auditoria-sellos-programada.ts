/**
 * Repasa los sellos de los certificados cada tantas horas (§6.4).
 *
 * ## Por qué se programa
 *
 * Al cerrar el 20-08-2026 que el sello se comprobara solo al leer, quedó una
 * pasada de auditoría para lo ya guardado **que había que acordarse de lanzar**.
 * Es la misma deuda que tuvo el barrido de visitantes durante meses: un
 * mantenimiento que depende de la memoria de alguien no es un mantenimiento.
 *
 * ## Qué añade sobre la puerta de la bajada
 *
 * La puerta comprueba lo que **entra**. Esto comprueba lo que **está**: un disco
 * que se degrada, una restauración de respaldo a medias o una mano en la base no
 * pasan por ninguna puerta. Aquí no hay nada que aplicar ni que rechazar, así
 * que lo único que se puede hacer es **darse cuenta**, y decirlo donde se mire.
 *
 * ## Una sola instancia repasa
 *
 * Igual que el barrido, y por la misma lección del 31-07-2026: dos
 * concentradores repasando a la vez llenarían el registro con el mismo aviso
 * dos veces. Aquí no se escribe nada en la base, así que el daño sería solo
 * ruido, pero el ruido es lo que hace que un aviso deje de mirarse.
 */
import { logger } from "../../config/logger";
import { prisma } from "../db/prismaClient";
import { auditarSellosDeCertificados } from "../../application/accounting/auditoria-de-sellos";

export interface EstadoDeLaAuditoria {
  /** `false` cuando no se programó: otra instancia manda, o está apagada. */
  readonly programada: boolean;
  readonly motivo?: string;
  readonly intervaloHoras?: number;
  readonly ultimaPasada?: {
    readonly at: string;
    readonly revisados: number;
    readonly intactos: number;
    readonly rotos: string[];
    readonly ok: boolean;
    readonly error?: string;
  };
}

let estado: EstadoDeLaAuditoria = {
  programada: false,
  motivo: "todavía no se ha arrancado",
};

/**
 * Lo que `/health` publica.
 *
 * Sin esto, «ningún certificado está roto» y «no se ha repasado nunca» se leen
 * igual, que es exactamente el problema que esta pasada viene a resolver.
 */
export const estadoDeLaAuditoriaDeSellos = (): EstadoDeLaAuditoria => estado;

/** Una pasada, sin lanzar nunca: un fallo aquí no puede tumbar la API. */
export async function repasarSellosUnaVez(): Promise<void> {
  try {
    const r = await auditarSellosDeCertificados(prisma as never);
    estado = {
      ...estado,
      ultimaPasada: {
        at: new Date().toISOString(),
        revisados: r.revisados,
        intactos: r.intactos,
        rotos: r.rotos,
        ok: true,
      },
    };
    if (r.rotos.length > 0) {
      // A nivel de error y con los identificadores dentro: es la única señal
      // que va a existir, porque aquí no hay nada que rechazar ni reparar.
      logger.error("Certificados con el sello roto", {
        revisados: r.revisados,
        rotos: r.rotos,
      });
      return;
    }
    logger.info("Sellos de certificados repasados", { revisados: r.revisados });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    estado = {
      ...estado,
      ultimaPasada: {
        at: new Date().toISOString(),
        revisados: 0,
        intactos: 0,
        rotos: [],
        ok: false,
        error: mensaje,
      },
    };
    logger.error("El repaso de sellos falló", { error: mensaje });
  }
}

export function programarAuditoriaDeSellos(opciones: {
  readonly otrasInstancias: number;
  readonly intervaloHoras: number;
  readonly habilitada: boolean;
  readonly retrasoInicialMs?: number;
}): EstadoDeLaAuditoria {
  if (!opciones.habilitada) {
    estado = { programada: false, motivo: "apagada por configuración" };
    logger.info("Auditoría de sellos apagada por configuración");
    return estado;
  }
  if (opciones.otrasInstancias > 0) {
    estado = {
      programada: false,
      motivo: `hay ${opciones.otrasInstancias} instancia(s) del concentrador ya viva(s); repasa la primera`,
    };
    return estado;
  }

  const intervaloMs = Math.max(1, opciones.intervaloHoras) * 60 * 60 * 1000;
  estado = { programada: true, intervaloHoras: opciones.intervaloHoras };

  const primera = setTimeout(
    () => void repasarSellosUnaVez(),
    opciones.retrasoInicialMs ?? 45_000,
  );
  const cada = setInterval(() => void repasarSellosUnaVez(), intervaloMs);
  // Que no impidan cerrar el proceso: es mantenimiento, no trabajo pendiente.
  primera.unref?.();
  cada.unref?.();

  logger.info("Auditoría de sellos programada", {
    cadaHoras: opciones.intervaloHoras,
  });
  return estado;
}
