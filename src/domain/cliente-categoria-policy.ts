/**
 * R5.3 — quién puede cambiar la categoría de un socio, y con qué.
 *
 * **Gemelo exacto** de `gym-local-api/src/domain/cliente-categoria-policy.ts`.
 * Si se toca una copia hay que tocar la otra: la regla decide dinero y no puede
 * significar cosas distintas en el escritorio y en la web.
 *
 * La decisión del dueño (10-08-2026), y su porqué:
 *
 *   - **El alta es libre.** Elegir «viejo» o «nuevo» al registrar a alguien es
 *     trabajo normal de recepción: la persona está delante y dice que ya fue
 *     socio. Obligar a llamar a administración para eso solo añade fricción.
 *   - **Cambiarla después es de administración, y con motivo.** Sobre alguien
 *     ya registrado, la categoría cambia el precio de todos sus cobros futuros
 *     y no hay nada que lo justifique salvo la palabra de alguien. Ese alguien
 *     tiene que quedar escrito, con su razón.
 *
 * El caso que lo motivó: al dar de baja una sede hay socios que se mueven, y
 * quien los reactiva necesita poder decir «este ya era socio». El borrado del
 * producto es lógico, así que un socio que vuelve **no se reinserta**: se
 * reactiva y se edita. Es decir, ese caso pasa justo por aquí.
 */

export type CategoriaCliente = "NUEVO" | "VIEJO";

export const CATEGORIAS: readonly CategoriaCliente[] = ["NUEVO", "VIEJO"];

/** Mínimo para que el motivo diga algo. Igual que en pausas y anulaciones. */
export const MOTIVO_CATEGORIA_MIN = 5;

export type DecisionCambioCategoria =
  | { permitido: true; huboCambio: false }
  | { permitido: true; huboCambio: true; motivo: string }
  | { permitido: false; status: 400 | 403; error: string };

const esAdmin = (rol: string | null | undefined) => {
  const r = String(rol ?? "").trim().toLowerCase();
  return r === "admin" || r === "administrador";
};

const normalizar = (v: string | null | undefined): CategoriaCliente | null => {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "NUEVO" || s === "VIEJO" ? s : null;
};

/**
 * Decide si una edición puede tocar la categoría.
 *
 * Devuelve `huboCambio: false` cuando la categoría entrante es la misma que ya
 * tenía —o no viene—, y eso **no exige nada**: el formulario manda el objeto
 * entero cada vez que se guarda, así que exigir motivo por reenviar el mismo
 * valor convertiría cada corrección de teléfono en un interrogatorio.
 */
export function decidirCambioCategoria(input: {
  categoriaActual: string | null | undefined;
  categoriaEntrante: string | null | undefined;
  rol: string | null | undefined;
  motivo: string | null | undefined;
}): DecisionCambioCategoria {
  const entrante = normalizar(input.categoriaEntrante);
  if (input.categoriaEntrante !== undefined && input.categoriaEntrante !== null && !entrante) {
    return {
      permitido: false,
      status: 400,
      error: `La categoría debe ser ${CATEGORIAS.join(" o ")}.`,
    };
  }
  if (!entrante) return { permitido: true, huboCambio: false };

  const actual = normalizar(input.categoriaActual) ?? "NUEVO";
  if (entrante === actual) return { permitido: true, huboCambio: false };

  if (!esAdmin(input.rol)) {
    return {
      permitido: false,
      status: 403,
      error:
        "Solo administración puede cambiar la categoría de un socio ya registrado. " +
        "Al darlo de alta sí puede elegirla recepción.",
    };
  }

  const motivo = String(input.motivo ?? "").trim();
  if (motivo.length < MOTIVO_CATEGORIA_MIN) {
    return {
      permitido: false,
      status: 400,
      error:
        "Cambiar la categoría exige un motivo de al menos " +
        `${MOTIVO_CATEGORIA_MIN} caracteres: cambia el precio de los cobros futuros.`,
    };
  }

  return { permitido: true, huboCambio: true, motivo };
}

/** Texto del aviso que ve administración. Gemelo en las dos APIs. */
export function mensajeCambioCategoria(input: {
  ci: string;
  nombre: string;
  desde: CategoriaCliente;
  hasta: CategoriaCliente;
  motivo: string;
}): string {
  return (
    `El socio ${input.ci} (${input.nombre}) pasó de categoría ${input.desde} a ` +
    `${input.hasta}. Motivo: ${input.motivo}`
  );
}

/** Rechazo con su código: 403 si no es administración, 400 si falta el motivo. */
export class CategoriaCambioError extends Error {
  constructor(message: string, readonly status: 400 | 403) {
    super(message);
    this.name = "CategoriaCambioError";
  }
}
