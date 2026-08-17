import { accesoCubre } from "../../domain/acceso-multisede-policy";

/**
 * La **única** excepción al aislamiento por sede en las referencias de
 * asistencia (M4a, docs/MULTI_SEDE.md §5.2 punto 3).
 *
 * El resto del sistema exige que lo referenciado pertenezca al gimnasio
 * autenticado, y con razón: es lo que impide que una sede escriba sobre datos
 * de otra. Pero un socio con acceso multi-sede entrena donde no está su ficha,
 * y su asistencia referencia legítimamente a un socio de otra sede.
 *
 * La puerta se abre **solo** con estas tres condiciones, y las tres se
 * comprueban contra la base, no contra lo que diga el evento:
 *
 *   1. el socio existe —en la sede que sea— y no está borrado;
 *   2. tiene acceso multi-sede **activo y vigente hoy**;
 *   3. la sede que registra la entrada no es la suya, que es lo que lo hace
 *      visitante y no un socio mal enrutado.
 *
 * Falla cerrado: cualquier duda deja la referencia rechazada como antes. Y no
 * se generaliza a otras entidades a propósito —«sin abrir la puerta para el
 * resto», dice §5.2—: un pago o una membresía cruzada son M4b y traen consigo
 * el saldo entre sedes.
 */
export async function esVisitanteAutorizado(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  /** Sede que registra la entrada. */
  gymId: string;
  /** Fecha de negocio de esa sede. */
  fechaNegocio: Date;
}): Promise<boolean> {
  const ci = String(input.ci ?? "").trim();
  if (!ci) return false;

  const [cliente, acceso] = await Promise.all([
    input.tx.cliente.findFirst({
      where: { ci, is_deleted: false },
      select: { gym_id: true },
    }),
    input.tx.clienteAccesoMultisede.findFirst({
      where: { ci, is_deleted: false },
    }),
  ]);
  if (!cliente) return false;

  const origen = String(cliente.gym_id ?? "").trim();
  if (!origen || origen === String(input.gymId ?? "").trim()) return false;

  return accesoCubre(acceso, input.fechaNegocio);
}
