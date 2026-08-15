/**
 * Proyección runtime de la matriz canónica de
 * `shared/catalogos/roles-producto.ts`.
 *
 * Vive dentro de `src` porque el `tsconfig` de la API no permite importar
 * fuentes externas a su `rootDir`. La prueba raíz
 * `scripts/rbac-runtime-parity.test.ts` impide que esta proyección y su gemela
 * local diverjan del catálogo compartido.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  admin: [
    "clientes.leer",
    "clientes.escribir",
    "cobros.registrar",
    "tesoreria.cerrar",
    "tesoreria.reabrir",
    "gastos.gobernar",
    "entrenadores.gestionar",
    "estadisticas.leer",
    "configuracion.escribir",
  ],
  reception: [
    "clientes.leer",
    "clientes.escribir",
    "cobros.registrar",
    "entrenadores.gestionar",
  ],
  accounting: [
    "clientes.leer",
    "tesoreria.cerrar",
    "gastos.gobernar",
    "estadisticas.leer",
  ],
  trainer: ["clientes.leer", "estadisticas.leer"],
};

const ROLE_ALIASES: Readonly<Record<string, string>> = {
  admin: "admin",
  administrador: "admin",
  reception: "reception",
  recepcion: "reception",
  "recepción": "reception",
  recepcionista: "reception",
  operador: "reception",
  accounting: "accounting",
  contabilidad: "accounting",
  contador: "accounting",
  trainer: "trainer",
  entrenador: "trainer",
};

export function canonicalRole(role: unknown): string | null {
  return ROLE_ALIASES[String(role ?? "").trim().toLocaleLowerCase()] ?? null;
}

export function permissionsForRole(role: unknown): readonly string[] {
  const canonical = canonicalRole(role);
  return canonical ? (ROLE_PERMISSIONS[canonical] ?? []) : [];
}

export function roleHasPermission(role: unknown, action: string): boolean {
  return permissionsForRole(role).includes(action);
}
