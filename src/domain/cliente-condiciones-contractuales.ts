/**
 * Qué condiciones del contrato NO se cambian editando la ficha del socio.
 *
 * La ficha es un formulario de datos personales que, de paso, dejaba tocar
 * cuatro cosas con consecuencias financieras o de acceso:
 *
 * - **el entrenador**, que tiene su propio flujo formal
 *   (`POST /membresias/:id/cambiar-entrenador`): previsualiza el efecto, exige
 *   motivo, **cierra las cuotas de comisión y los devengos** del entrenador que
 *   sale y deja aviso a administración. Cambiarlo desde la ficha no hacía nada
 *   de eso: el campo cambiaba y las comisiones quedaban colgando del anterior.
 * - **el plan**, que decide el precio de todo cobro futuro y que se cambia
 *   contratando (la membresía nueva nace con origen `CAMBIO`).
 * - **las fechas de cobertura**, que las derivan las membresías. Editarlas a
 *   mano desincroniza la proyección del socio de las membresías que la
 *   sostienen, y alarga el acceso al gimnasio sin que nadie haya pagado.
 *
 * La regla es la misma que la de categoría, y por el mismo motivo: **el
 * formulario reenvía el modelo entero en cada guardado**, cambie el operador lo
 * que cambie. Comparar contra lo almacenado es lo único que distingue «lo tocó»
 * de «venía en el cuerpo». Sin eso, guardar un teléfono fallaría por culpa del
 * plan que nadie tocó.
 *
 * Gemela exacta de la del remoto. Si tocas una, mira la otra.
 */

export interface CondicionContractual {
  campo: string;
  /** Cómo se llama para el operador, que no lee nombres de columna. */
  etiqueta: string;
  /** Qué debe usar en su lugar. */
  via: string;
}

export const CONDICIONES_CONTRACTUALES: CondicionContractual[] = [
  {
    campo: "id_entrenador",
    etiqueta: "el entrenador asignado",
    via: "Cambiar entrenador, desde el expediente del socio",
  },
  {
    campo: "id_planes_pago",
    etiqueta: "el plan contratado",
    via: "Cobrar, que contrata la membresía nueva",
  },
  {
    campo: "fecha_inicio",
    etiqueta: "el inicio de la cobertura",
    via: "Cobrar, que fija el periodo",
  },
  {
    campo: "fecha_fin",
    etiqueta: "el fin de la cobertura",
    via: "Cobrar, que fija el periodo",
  },
];

export class CondicionContractualError extends Error {
  constructor(message: string, readonly status: 409 = 409) {
    super(message);
    this.name = "CondicionContractualError";
  }
}

/** Normaliza para comparar: null, undefined y "" son lo mismo. */
function normalizar(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  const texto = String(valor).trim();
  if (texto === "") return null;
  // Una fecha ISO completa y su día son la misma condición: el formulario manda
  // el instante y la base guarda el día.
  const fecha = /^\d{4}-\d{2}-\d{2}/.exec(texto);
  return fecha ? fecha[0]! : texto;
}

export interface CambioContractual {
  campo: string;
  etiqueta: string;
  via: string;
  desde: string | null;
  hasta: string | null;
}

/**
 * Devuelve las condiciones que el cuerpo intenta cambiar de verdad.
 *
 * Un campo ausente no es un cambio. Un campo con el mismo valor que ya está
 * guardado, tampoco: es el formulario reenviando lo que leyó.
 */
export function detectarCambiosContractuales(input: {
  entrante: Record<string, unknown>;
  almacenado: Record<string, unknown>;
}): CambioContractual[] {
  const cambios: CambioContractual[] = [];
  for (const condicion of CONDICIONES_CONTRACTUALES) {
    if (!(condicion.campo in input.entrante)) continue;
    const entrante = normalizar(input.entrante[condicion.campo]);
    if (entrante === undefined) continue;
    const actual = normalizar(input.almacenado[condicion.campo]);
    if (entrante === actual) continue;
    cambios.push({
      campo: condicion.campo,
      etiqueta: condicion.etiqueta,
      via: condicion.via,
      desde: actual,
      hasta: entrante,
    });
  }
  return cambios;
}

/** El mensaje que ve el operador. Dice qué intentó y por dónde se hace. */
export function mensajeCambioContractual(cambios: CambioContractual[]): string {
  if (cambios.length === 1) {
    const c = cambios[0]!;
    return (
      `Desde la ficha no se cambia ${c.etiqueta}: tiene consecuencias sobre ` +
      `cobros o comisiones y se hace por «${c.via}».`
    );
  }
  const lista = cambios.map((c) => c.etiqueta).join(", ");
  return (
    `Desde la ficha no se cambian estas condiciones del contrato: ${lista}. ` +
    `Cada una tiene su propio flujo, que deja constancia de lo que mueve.`
  );
}

/** Lanza si el cuerpo intenta cambiar una condición contractual. */
export function exigirFlujoFormal(input: {
  entrante: Record<string, unknown>;
  almacenado: Record<string, unknown>;
}): void {
  const cambios = detectarCambiosContractuales(input);
  if (cambios.length === 0) return;
  throw new CondicionContractualError(mensajeCambioContractual(cambios));
}
