/**
 * R5.2 — Política de cuotas del cliente en planes largos.
 *
 * Un plan largo (trimestral, semestral, anual) puede pagarse por cuotas con
 * calendario asiméntico: cada cuota tiene un importe y un tramo de cobertura
 * (días de servicio que compra). La suma de los días de cobertura debe igualar
 * la duración total del plan; la suma de los importes debe igualar el precio.
 *
 * Esta política es pura: no toca base de datos. Construye el calendario de
 * cuotas de una membresía a partir de su esquema, valida su coherencia y
 * clasifica el estado de morosidad de cada cuota para el control de acceso.
 */
import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";
import { addCalendarDays } from "./membership-policy";

export class PlanInstallmentPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanInstallmentPolicyError";
  }
}

/** Tramo definido en el catálogo del plan (entrada). */
export type InstallmentSchemeInput = {
  numeroCuota: number;
  importe: string;
  diasCobertura: number;
};

/** Cuota materializada con sus fechas de tramo y exigibilidad (salida). */
export type InstallmentScheduleItem = {
  numeroCuota: number;
  importe: string;
  diasCobertura: number;
  fechaExigible: Date;
  fechaCoberturaInicio: Date;
  fechaCoberturaFinExclusive: Date;
};

/** Estado de morosidad de una cuota respecto al día de negocio. */
export type InstallmentOverdueState =
  | "AL_DIA"
  | "VIGENTE"
  | "VENCIDA_EN_GRACIA"
  | "MOROSA";

const DAY_MS = 86_400_000;

/**
 * Construye el calendario de cuotas de una membresía a partir de su esquema.
 * Valida que los importes sumen el precio del plan y los días de cobertura
 * sumen la duración total; las cuotas deben ser secuenciales desde 1.
 */
export function buildInstallmentSchedule(input: {
  planPrice: string;
  planDurationDays: number;
  membershipStart: Date;
  scheme: InstallmentSchemeInput[];
}): InstallmentScheduleItem[] {
  if (!Array.isArray(input.scheme) || input.scheme.length === 0) {
    throw new PlanInstallmentPolicyError(
      "El esquema de cuotas no puede estar vacío.",
    );
  }

  // Ordena por numeroCuota y valida secuencia desde 1.
  const sorted = [...input.scheme].sort(
    (a, b) => a.numeroCuota - b.numeroCuota,
  );
  sorted.forEach((item, index) => {
    if (item.numeroCuota !== index + 1) {
      throw new PlanInstallmentPolicyError(
        `Las cuotas deben ser secuenciales desde 1 (cuota ${item.numeroCuota} fuera de orden).`,
      );
    }
    if (!Number.isInteger(item.diasCobertura) || item.diasCobertura <= 0) {
      throw new PlanInstallmentPolicyError(
        `La cuota ${item.numeroCuota} debe cubrir un número positivo de días.`,
      );
    }
  });

  // Valida suma de días de cobertura == duración del plan.
  const totalCoverageDays = sorted.reduce(
    (sum, item) => sum + item.diasCobertura,
    0,
  );
  if (totalCoverageDays !== input.planDurationDays) {
    throw new PlanInstallmentPolicyError(
      `La suma de días de cobertura (${totalCoverageDays}) no coincide con la duración del plan (${input.planDurationDays}).`,
    );
  }

  // Valida suma de importes == precio del plan (en minor units, sin floats).
  const priceMinor = parseMoney(input.planPrice, "precio del plan");
  let importeMinorSum = 0n;
  for (const item of sorted) {
    if (parseMoney(item.importe, `importe de la cuota ${item.numeroCuota}`) <= 0n) {
      throw new PlanInstallmentPolicyError(
        `La cuota ${item.numeroCuota} debe tener un importe positivo.`,
      );
    }
    importeMinorSum += parseMoney(item.importe, `importe de la cuota ${item.numeroCuota}`);
  }
  if (importeMinorSum !== priceMinor) {
    throw new PlanInstallmentPolicyError(
      `La suma de importes (${treasuryMinorToMoney(importeMinorSum)}) no coincide con el precio del plan (${input.planPrice}).`,
    );
  }

  // Materializa fechas: cada cuota cubre [inicio, finExclusive) contiguo.
  const start = calendarUtc(input.membershipStart);
  let cursor = start;
  return sorted.map((item) => {
    const coverageStart = cursor;
    const coverageEndExclusive = addCalendarDays(coverageStart, item.diasCobertura);
    const result: InstallmentScheduleItem = {
      numeroCuota: item.numeroCuota,
      importe: item.importe,
      diasCobertura: item.diasCobertura,
      // Exigible desde el inicio de su tramo (se puede cobrar al empezar).
      fechaExigible: coverageStart,
      fechaCoberturaInicio: coverageStart,
      fechaCoberturaFinExclusive: coverageEndExclusive,
    };
    cursor = coverageEndExclusive;
    return result;
  });
}

/**
 * Clasifica el estado de morosidad de una cuota respecto al día de negocio.
 *
 * - AL_DIA: la cuota está pagada (o anticipada).
 * - VIGENTE: el día de negocio cae antes del inicio del tramo (todavía no se debe).
 * - VENCIDA_EN_GRACIA: el tramo ya empezó, la cuota está pendiente, pero dentro
 *   de los días de gracia configurados.
 * - MOROSA: el tramo empezó, la cuota está pendiente y se agotó la gracia.
 *
 * La gracia se cuenta desde el inicio del tramo de cobertura.
 */
export function classifyInstallmentOverdue(input: {
  cuota: {
    estado: string;
    fechaCoberturaInicio: Date;
    fechaCoberturaFinExclusive: Date;
  };
  businessDate: Date;
  graceDays: number;
}): InstallmentOverdueState {
  const isPaid = input.cuota.estado === "PAGADA" || input.cuota.estado === "ANTICIPADA";
  if (isPaid) return "AL_DIA";

  const business = calendarUtc(input.businessDate);
  const coverageStart = calendarUtc(input.cuota.fechaCoberturaInicio);
  const coverageEndExclusive = calendarUtc(input.cuota.fechaCoberturaFinExclusive);

  // Antes de que empiece el tramo: no se debe todavía.
  if (business.getTime() < coverageStart.getTime()) {
    return "VIGENTE";
  }
  // El día de negocio cae dentro o después del tramo y la cuota no está pagada.
  const graceEndExclusive = addCalendarDays(coverageStart, input.graceDays + 1);
  if (business.getTime() < graceEndExclusive.getTime()) {
    return "VENCIDA_EN_GRACIA";
  }
  return "MOROSA";
}

/**
 * Determina si una membresía con cuotas tiene acceso permitido en el día de
 * negocio. El acceso se bloquea si la cuota que cubre el día (o la última
 * cuota vencida) está MOROSA. VENCIDA_EN_GRACIA permite entrar (la gracia es
 * una cortesía configurable, no un corte duro).
 */
export function isMembershipAccessBlocked(input: {
  cuotas: Array<{
    numeroCuota: number;
    estado: string;
    fechaCoberturaInicio: Date;
    fechaCoberturaFinExclusive: Date;
  }>;
  businessDate: Date;
  graceDays: number;
}): { blocked: boolean; blockingCuota?: number; reason?: string } {
  const business = calendarUtc(input.businessDate);
  for (const cuota of input.cuotas) {
    const coverageStart = calendarUtc(cuota.fechaCoberturaInicio);
    const coverageEndExclusive = calendarUtc(cuota.fechaCoberturaFinExclusive);
    // Si el día cae dentro del tramo, esta es la cuota que rige el acceso.
    if (
      business.getTime() >= coverageStart.getTime() &&
      business.getTime() < coverageEndExclusive.getTime()
    ) {
      const state = classifyInstallmentOverdue({
        cuota,
        businessDate: input.businessDate,
        graceDays: input.graceDays,
      });
      if (state === "MOROSA") {
        return {
          blocked: true,
          blockingCuota: cuota.numeroCuota,
          reason: `Cuota ${cuota.numeroCuota} vencida; regularice el pago para ingresar.`,
        };
      }
      return { blocked: false };
    }
  }
  // El día cae fuera de todos los tramos (antes de la cuota 1 o después de la
  // última). Antes de la cuota 1 no debería ocurrir si la membresía se activó;
  // después de la última, la membresía está vencida por fecha_fin.
  return { blocked: false };
}

function parseMoney(value: unknown, field: string): bigint {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new PlanInstallmentPolicyError(`Falta el campo ${field}.`);
  }
  try {
    return treasuryMoneyToMinor(text);
  } catch {
    throw new PlanInstallmentPolicyError(
      `${field} no contiene un importe decimal válido.`,
    );
  }
}

function calendarUtc(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

// Exportado para reutilización en servicios que necesiten validar rangos.
export { DAY_MS };
