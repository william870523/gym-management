/**
 * Análisis del carné de identidad cubano.
 *
 * Gemelo exacto del parser Dart `gym_client/lib/src/core/utils/cuba_ci.dart` y
 * de su copia en `gym-local-api`. Las TRES implementaciones se validan contra
 * la misma tabla de vectores, `shared/cuba-ci/vectors.json`: un cambio de regla
 * se hace en los tres sitios y en los vectores, nunca en uno solo.
 *
 * Estructura del número (11 dígitos): AAMMDD S NN X V
 *   0-1  año dentro del siglo      6  siglo (9 = XIX, 0-5 = XX, 6-8 = XXI)
 *   2-3  mes                       9  sexo (par = masculino, impar = femenino)
 *   4-5  día                      10  dígito final
 *
 * El dígito 11 se conserva pero no se valida: no existe fórmula pública
 * verificable de su checksum.
 *
 * `fechaReferencia` es un día de calendario que suministra la aplicación en la
 * zona del gimnasio. Este módulo NUNCA consulta el reloj ni la zona del proceso
 * (contrato de tiempo, `docs/TIME_CONTRACT.md`).
 */

export type CubaCiSexo = "masculino" | "femenino";

export type CubaCiEstado = "vacio" | "incompleto" | "invalido" | "valido";

export type CubaCiErrorCodigo =
    | "caracteresNoNumericos"
    | "longitud"
    | "mesInvalido"
    | "diaInvalido"
    | "fechaInvalida"
    | "fechaFutura"
    | "edadFueraRango";

export interface CubaCiError {
    codigo: CubaCiErrorCodigo;
    mensaje: string;
}

export interface CubaCiAnalisis {
    raw: string;
    normalizado: string;
    estado: CubaCiEstado;
    anio: number | null;
    mes: number | null;
    dia: number | null;
    siglo: string | null;
    /** Día de calendario en UTC a medianoche, o null si no se pudo resolver. */
    fechaNacimiento: Date | null;
    edad: number | null;
    sexoCodificado: CubaCiSexo | null;
    errores: CubaCiError[];
}

export interface AnalizarCubaCiOpciones {
    /** Día de calendario en la zona del gimnasio. Sin él no se calcula edad. */
    fechaReferencia?: Date | null;
    edadMaxima?: number;
}

export const EDAD_MAXIMA_ADMITIDA = 100;

export function sexoDesdeDigito10(digito: string): CubaCiSexo | null {
    if (!/^\d$/.test(digito)) return null;
    return Number(digito) % 2 === 0 ? "masculino" : "femenino";
}

export function analizarCubaCi(
    raw: string,
    opciones: AnalizarCubaCiOpciones = {},
): CubaCiAnalisis {
    const { fechaReferencia = null, edadMaxima = EDAD_MAXIMA_ADMITIDA } = opciones;
    const value = (raw ?? "").trim();

    const base = {
        raw: raw ?? "",
        normalizado: value,
        anio: null,
        mes: null,
        dia: null,
        siglo: null,
        fechaNacimiento: null,
        edad: null,
        sexoCodificado: null,
    } satisfies Omit<CubaCiAnalisis, "estado" | "errores">;

    if (value.length === 0) {
        return { ...base, estado: "vacio", errores: [] };
    }

    if (!/^\d+$/.test(value)) {
        return {
            ...base,
            estado: "invalido",
            errores: [
                {
                    codigo: "caracteresNoNumericos",
                    mensaje: "El CI cubano se compone únicamente de dígitos.",
                },
            ],
        };
    }

    if (value.length > 11) {
        return {
            ...base,
            estado: "invalido",
            errores: [
                {
                    codigo: "longitud",
                    mensaje: "El CI cubano tiene exactamente 11 dígitos.",
                },
            ],
        };
    }

    const errores: CubaCiError[] = [];
    let anio: number | null = null;
    let mes: number | null = null;
    let dia: number | null = null;
    let siglo: string | null = null;
    let fechaNacimiento: Date | null = null;
    let edad: number | null = null;
    let sexoCodificado: CubaCiSexo | null = null;

    if (value.length >= 4) {
        mes = Number(value.slice(2, 4));
        if (mes < 1 || mes > 12) {
            errores.push({
                codigo: "mesInvalido",
                mensaje: "Mes inválido: debe estar entre 01 y 12.",
            });
        }
    }

    if (value.length === 3 && Number(value[2]) > 1) {
        errores.push({
            codigo: "mesInvalido",
            mensaje: "El primer dígito del mes debe ser 0 o 1.",
        });
    }

    if (value.length >= 6) {
        dia = Number(value.slice(4, 6));
        if (dia < 1 || dia > 31) {
            errores.push({
                codigo: "diaInvalido",
                mensaje: "Día inválido: debe estar entre 01 y 31.",
            });
        } else if (mes !== null && mes >= 1 && mes <= 12 && dia > diaMaximoPosible(mes)) {
            errores.push({
                codigo: "diaInvalido",
                mensaje: `Día inválido para el mes ${value.slice(2, 4)}.`,
            });
        }
    }

    if (value.length === 5 && Number(value[4]) > 3) {
        errores.push({
            codigo: "diaInvalido",
            mensaje: "El primer dígito del día debe estar entre 0 y 3.",
        });
    }

    if (value.length >= 7) {
        const anioEnSiglo = Number(value.slice(0, 2));
        const digitoSiglo = value[6]!;
        if (digitoSiglo === "9") {
            anio = 1800 + anioEnSiglo;
            siglo = "XIX";
        } else if (digitoSiglo <= "5") {
            anio = 1900 + anioEnSiglo;
            siglo = "XX";
        } else {
            anio = 2000 + anioEnSiglo;
            siglo = "XXI";
        }

        const fechaUtilizable =
            mes !== null &&
            dia !== null &&
            mes >= 1 &&
            mes <= 12 &&
            dia >= 1 &&
            dia <= 31 &&
            errores.every(
                (error) =>
                    error.codigo !== "diaInvalido" && error.codigo !== "mesInvalido",
            );

        if (fechaUtilizable) {
            const candidato = diaUtc(anio, mes!, dia!);
            const fechaExacta =
                candidato.getUTCFullYear() === anio &&
                candidato.getUTCMonth() === mes! - 1 &&
                candidato.getUTCDate() === dia!;
            if (!fechaExacta) {
                errores.push({
                    codigo: "fechaInvalida",
                    mensaje: "La fecha de nacimiento codificada no existe.",
                });
            } else {
                fechaNacimiento = candidato;
                if (fechaReferencia) {
                    const diaReferencia = diaUtc(
                        fechaReferencia.getUTCFullYear(),
                        fechaReferencia.getUTCMonth() + 1,
                        fechaReferencia.getUTCDate(),
                    );
                    if (candidato.getTime() > diaReferencia.getTime()) {
                        errores.push({
                            codigo: "fechaFutura",
                            mensaje:
                                "La fecha de nacimiento codificada está en el futuro.",
                        });
                    } else {
                        edad = edadEn(candidato, diaReferencia);
                        if (edad > edadMaxima) {
                            errores.push({
                                codigo: "edadFueraRango",
                                mensaje:
                                    `La fecha corresponde a una persona de ${edad} años; ` +
                                    `el máximo admitido es ${edadMaxima}.`,
                            });
                        }
                    }
                }
            }
        }
    }

    if (value.length >= 10) {
        sexoCodificado = sexoDesdeDigito10(value[9]!);
    }

    const estado: CubaCiEstado =
        errores.length > 0
            ? "invalido"
            : value.length === 11
              ? "valido"
              : "incompleto";

    return {
        raw: raw ?? "",
        normalizado: value,
        estado,
        anio,
        mes,
        dia,
        siglo,
        fechaNacimiento,
        edad,
        sexoCodificado,
        errores,
    };
}

/**
 * Construye un día de calendario en UTC sin caer en la trampa de `Date.UTC`,
 * que reasigna los años de dos cifras al siglo XX.
 */
function diaUtc(anio: number, mes: number, dia: number): Date {
    const fecha = new Date(0);
    fecha.setUTCFullYear(anio, mes - 1, dia);
    fecha.setUTCHours(0, 0, 0, 0);
    return fecha;
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

function diaMaximoPosible(mes: number): number {
    if (mes === 2) return 29;
    if (mes === 4 || mes === 6 || mes === 9 || mes === 11) return 30;
    return 31;
}
