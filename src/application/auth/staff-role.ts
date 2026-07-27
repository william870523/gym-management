/**
 * Puestos canónicos del personal (docs/REMOTE_ROLE_SCOPE.md §2).
 *
 * La base tiene variantes históricas —hay cuentas con `recepcionista` junto a
 * las de `reception`— y el cliente Flutter ya las normaliza igual. Se hace en
 * un solo sitio para que ninguna ruta compare textos a mano.
 *
 * Un rol desconocido NO es personal: devuelve `null` y los guardianes lo
 * rechazan. El reparto fino de permisos por vista es una unidad posterior.
 */
export type StaffRole = "admin" | "reception";

const STAFF_ROLE_ALIASES: Record<string, StaffRole> = {
    admin: "admin",
    administrador: "admin",
    administracion: "admin",
    "administración": "admin",
    reception: "reception",
    recepcion: "reception",
    "recepción": "reception",
    recepcionista: "reception",
    operador: "reception",
};

export const normalizeStaffRole = (
    role: string | null | undefined,
): StaffRole | null => {
    if (!role) return null;
    return STAFF_ROLE_ALIASES[role.trim().toLowerCase()] ?? null;
};
