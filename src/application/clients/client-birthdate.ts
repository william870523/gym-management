/**
 * Resolución de la fecha de nacimiento del cliente (E0, §7-bis del plan de
 * estadísticas).
 *
 * Regla única, aplicada igual en el alta y en la edición:
 *
 *   CI_CUBANO            → la DERIVA el servidor de los 11 dígitos. Lo que
 *                          venga en el cuerpo se ignora: si el servidor puede
 *                          deducir un dato, no lo acepta del cliente.
 *   PASAPORTE / OTRO     → se captura. Obligatoria al dar de alta; al editar se
 *                          valida si llega y no se exige si no llega, para no
 *                          bloquear cambios ajenos (un teléfono, una dirección).
 *   DESCONOCIDO          → opcional siempre. El tipo significa literalmente que
 *                          no se sabe qué documento es; exigir una fecha exacta
 *                          ahí se contradice. Si llega, se valida.
 *
 * Gemelo: `gym-local-api/src/application/client/client-birthdate.ts`.
 */
import { analizarCubaCi, EDAD_MAXIMA_ADMITIDA } from "./cuba-ci";

export interface ResolverFechaNacimientoEntrada {
    /** Tipo de documento EFECTIVO tras aplicar el cambio (no el del cuerpo). */
    tipoDocumento: string | null | undefined;
    /** CI efectivo del cliente. En edición, el almacenado: la clave no se edita. */
    ci: string | null | undefined;
    /** Lo que llegó en el cuerpo de la petición, sin sanear. */
    fechaNacimientoEntrante?: unknown;
    /** Lo que ya está guardado. Solo se usa en edición. */
    fechaNacimientoActual?: Date | null;
    /** Día de calendario en la zona del gimnasio. */
    fechaNegocio: Date;
    esAlta: boolean;
}

/** Documentos que exigen capturar la fecha al dar de alta. */
const EXIGEN_CAPTURA = new Set(["PASAPORTE", "OTRO"]);

export function resolverFechaNacimiento(
    entrada: ResolverFechaNacimientoEntrada,
): Date | null {
    const tipo = String(entrada.tipoDocumento ?? "DESCONOCIDO");

    if (tipo === "CI_CUBANO") {
        const analisis = analizarCubaCi(String(entrada.ci ?? ""), {
            fechaReferencia: entrada.fechaNegocio,
        });
        if (analisis.estado !== "valido" || analisis.fechaNacimiento === null) {
            const detalle =
                analisis.errores[0]?.mensaje ??
                "El número no tiene los 11 dígitos de un carné cubano.";
            throw new Error(
                `El carné de identidad no es válido, así que no se puede ` +
                    `derivar la fecha de nacimiento: ${detalle}`,
            );
        }
        return analisis.fechaNacimiento;
    }

    const entrante = normalizarFecha(entrada.fechaNacimientoEntrante);
    if (entrante !== null) {
        validarFechaManual(entrante, entrada.fechaNegocio);
        return entrante;
    }

    if (entrada.esAlta && EXIGEN_CAPTURA.has(tipo)) {
        throw new Error(
            "La fecha de nacimiento es obligatoria cuando el documento no es " +
                "un carné de identidad cubano.",
        );
    }

    return entrada.fechaNacimientoActual ?? null;
}

/**
 * Acepta Date o texto ISO y devuelve el día de calendario en UTC. Un valor
 * vacío o ausente devuelve null; uno ilegible es un error, no un null
 * silencioso.
 */
export function normalizarFecha(valor: unknown): Date | null {
    if (valor === null || valor === undefined) return null;
    if (valor instanceof Date) {
        if (Number.isNaN(valor.getTime())) {
            throw new Error("La fecha de nacimiento no es una fecha válida.");
        }
        return diaUtc(valor);
    }
    const texto = String(valor).trim();
    if (texto === "") return null;
    const fecha = new Date(texto.length === 10 ? `${texto}T00:00:00.000Z` : texto);
    if (Number.isNaN(fecha.getTime())) {
        throw new Error("La fecha de nacimiento no es una fecha válida.");
    }
    return diaUtc(fecha);
}

function validarFechaManual(fecha: Date, fechaNegocio: Date) {
    if (fecha.getTime() > fechaNegocio.getTime()) {
        throw new Error("La fecha de nacimiento no puede estar en el futuro.");
    }
    const edad = edadEn(fecha, fechaNegocio);
    if (edad > EDAD_MAXIMA_ADMITIDA) {
        throw new Error(
            `La fecha corresponde a una persona de ${edad} años; el máximo ` +
                `admitido es ${EDAD_MAXIMA_ADMITIDA}.`,
        );
    }
}

function diaUtc(fecha: Date): Date {
    const dia = new Date(0);
    dia.setUTCFullYear(
        fecha.getUTCFullYear(),
        fecha.getUTCMonth(),
        fecha.getUTCDate(),
    );
    dia.setUTCHours(0, 0, 0, 0);
    return dia;
}

function edadEn(fechaNacimiento: Date, fechaReferencia: Date): number {
    let edad = fechaReferencia.getUTCFullYear() - fechaNacimiento.getUTCFullYear();
    const cumpleanosPasado =
        fechaReferencia.getUTCMonth() > fechaNacimiento.getUTCMonth() ||
        (fechaReferencia.getUTCMonth() === fechaNacimiento.getUTCMonth() &&
            fechaReferencia.getUTCDate() >= fechaNacimiento.getUTCDate());
    if (!cumpleanosPasado) edad -= 1;
    return edad;
}
