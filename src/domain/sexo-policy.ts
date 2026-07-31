/**
 * Vocabulario único del sexo (docs/PLAN_ESTADISTICAS.md §7).
 *
 * Por qué existe (31-07-2026): la columna era texto libre y **cada quien
 * escribía lo suyo**. El formulario del cliente guardaba la etiqueta larga
 * —`Masculino`, `Femenino`— y los scripts de fixture escribían el código corto
 * —`M`, `F`— directamente en la base. Nadie normalizaba en el servidor, así que
 * las cuatro formas convivieron: 53 `Masculino`, 51 `Femenino`, 2 `M` y 1 `F`
 * en socios, y 2+2+1+1 en entrenadores. Cualquier dona por sexo salía con
 * cuatro porciones para dos sexos, y así lo destapó la alerta de calidad de
 * datos de la portada.
 *
 * La regla es la que pidió el dueño: **lo que se ve en pantalla es lo que se
 * guarda**. El desplegable enseña «Masculino» y en la base pone `Masculino`.
 *
 * Y la normalización la hace **el servidor**, no el formulario, por la misma
 * razón que la fecha de nacimiento (§7-bis): un dato de negocio no se acepta
 * del cuerpo de la petición si el servidor puede decidirlo. Así ni un script,
 * ni una versión vieja del cliente, ni la sincronización pueden volver a meter
 * una forma nueva.
 *
 * Gemelo exacto en `gym-remote-api/src/domain/sexo-policy.ts`.
 */

export const SEXO_MASCULINO = "Masculino";
export const SEXO_FEMENINO = "Femenino";
export const SEXO_OTRO = "Otro";

/** Los únicos valores que pueden llegar a la base. */
export const SEXOS_CANONICOS = [
  SEXO_MASCULINO,
  SEXO_FEMENINO,
  SEXO_OTRO,
] as const;

export type SexoCanonico = (typeof SEXOS_CANONICOS)[number];

/**
 * Formas heredadas que se saben traducir. La lista es explícita a propósito:
 * adivinar por la primera letra convertiría un «Mujer» mal tecleado en
 * masculino sin que nadie se enterara.
 */
const EQUIVALENCIAS: Record<string, SexoCanonico> = {
  m: SEXO_MASCULINO,
  masculino: SEXO_MASCULINO,
  hombre: SEXO_MASCULINO,
  male: SEXO_MASCULINO,
  f: SEXO_FEMENINO,
  femenino: SEXO_FEMENINO,
  mujer: SEXO_FEMENINO,
  female: SEXO_FEMENINO,
  o: SEXO_OTRO,
  otro: SEXO_OTRO,
  otra: SEXO_OTRO,
  other: SEXO_OTRO,
  x: SEXO_OTRO,
};

/** Quita acentos y espacios para comparar sin depender de cómo se tecleó. */
function clave(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Devuelve el valor canónico, o `null` si no se sabe qué es.
 *
 * `null` no es «Otro»: «Otro» es una respuesta que alguien dio, y un valor
 * ilegible es un dato que no se entiende. Convertir uno en el otro sería
 * inventar una respuesta.
 */
export function normalizarSexo(valor: unknown): SexoCanonico | null {
  if (valor === null || valor === undefined) return null;
  const texto = clave(String(valor));
  if (texto.length === 0) return null;
  return EQUIVALENCIAS[texto] ?? null;
}

export class SexoInvalido extends Error {
  constructor(valor: unknown) {
    super(
      `El sexo «${String(valor)}» no es válido. Valores admitidos: ` +
        `${SEXOS_CANONICOS.join(", ")}.`,
    );
  }
}

/**
 * Normaliza para escribir. Lanza si no se entiende: es preferible rechazar el
 * alta a guardar una quinta forma y volver al problema de origen.
 */
export function exigirSexoCanonico(valor: unknown): SexoCanonico {
  const normalizado = normalizarSexo(valor);
  if (normalizado === null) throw new SexoInvalido(valor);
  return normalizado;
}

/** Igual, pero deja pasar la ausencia: sirve para actualizaciones parciales. */
export function normalizarSexoOpcional(
  valor: unknown,
): SexoCanonico | undefined {
  if (valor === undefined) return undefined;
  return exigirSexoCanonico(valor);
}
