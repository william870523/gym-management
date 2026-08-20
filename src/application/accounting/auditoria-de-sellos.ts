/**
 * Repasa el sello de los certificados guardados (§6.4).
 *
 * ## Por qué es una función y no solo un script
 *
 * La comprobación existía **al leer**: verificaba quien pedía la lista. Al
 * cerrarse eso el 20-08-2026, la bajada pasó a comprobar cada certificado **al
 * entrar** y quedó una pasada de auditoría para lo ya guardado… que había que
 * acordarse de lanzar. Un mantenimiento que depende de que alguien se acuerde no
 * es un mantenimiento; es la misma deuda que tuvo el barrido de visitantes hasta
 * que se programó.
 *
 * Así que el mismo código lo usan las dos bocas: el script de mano y el
 * programador. Escribir la pasada automática aparte del script acabaría con dos
 * comprobaciones que se parecen, y el día que importe dirán cosas distintas.
 *
 * ## Qué comprueba
 *
 * Recalcula el `sha256` del **texto que se firmó**, no de una foto reconstruida
 * desde las columnas: rehacerla mediría la serialización de hoy y no la firma de
 * entonces. No dice si el contenido es correcto —eso lo decidió quien firmó—,
 * solo si **es el mismo** que se selló.
 *
 * No repara nada, y es deliberado: un certificado es una foto sellada y
 * arreglarla sería falsificarla. Lo que procede con uno roto es volver a pedirlo
 * a quien lo firmó.
 */
import { certificadoIntacto } from "../../domain/certificado-cadena-policy";

/** Lo mínimo que hace falta para repasar los sellos. */
export interface LectorDeCertificados {
  readonly cierreCadenaCertificado: {
    findMany(args?: unknown): Promise<
      Array<{
        certificado_id: string;
        foto_json: string;
        foto_sha256: string;
        estado: string;
        is_deleted: boolean;
        ciclo_numero: number;
        fecha_inicio: Date;
        fecha_fin_exclusiva: Date;
      }>
    >;
  };
}

export interface SelloRepasado {
  readonly certificadoId: string;
  readonly intacto: boolean;
  readonly estado: string;
  readonly retirado: boolean;
  readonly cicloNumero: number;
  readonly desde: Date;
  readonly hastaExclusivo: Date;
}

export interface ResultadoDeLaAuditoria {
  readonly revisados: number;
  readonly intactos: number;
  /** Los que no cuadran, por su id. Vacío es la respuesta buena. */
  readonly rotos: string[];
  readonly detalle: SelloRepasado[];
}

export async function auditarSellosDeCertificados(
  db: LectorDeCertificados,
): Promise<ResultadoDeLaAuditoria> {
  const filas = await db.cierreCadenaCertificado.findMany({
    orderBy: [{ fecha_inicio: "asc" }, { ciclo_numero: "asc" }],
  });

  // Se repasan **también los retirados**: un certificado anulado sigue siendo la
  // prueba de lo que se cerró aquel día, y por eso se conserva en vez de
  // borrarse. Si su sello dejara de cuadrar, esa prueba ya no vale.
  const detalle: SelloRepasado[] = filas.map((fila) => ({
    certificadoId: fila.certificado_id,
    intacto: certificadoIntacto({
      textoFirmado: fila.foto_json,
      sha256: fila.foto_sha256,
    }),
    estado: fila.estado,
    retirado: Boolean(fila.is_deleted),
    cicloNumero: fila.ciclo_numero,
    desde: fila.fecha_inicio,
    hastaExclusivo: fila.fecha_fin_exclusiva,
  }));

  const rotos = detalle.filter((s) => !s.intacto).map((s) => s.certificadoId);
  return {
    revisados: detalle.length,
    intactos: detalle.length - rotos.length,
    rotos,
    detalle,
  };
}
