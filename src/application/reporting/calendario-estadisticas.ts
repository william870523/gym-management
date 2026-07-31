/**
 * Proyección de un instante UTC al calendario de negocio de una sede.
 *
 * No se calcula un desplazamiento fijo: una misma zona puede tener offsets
 * distintos a lo largo del año por horario de verano. Cada instante se
 * proyecta por separado para que los históricos conserven su día y hora real.
 */
export interface PartesCalendarioLocal {
  dia: string;
  mes: string;
  hora: number;
  diaSemana: number;
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  const existente = formateadores.get(zona);
  if (existente) return existente;

  const creado = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  formateadores.set(zona, creado);
  return creado;
}

export function calendarioLocal(
  instante: Date,
  zona: string,
): PartesCalendarioLocal {
  const partes = formateador(zona).formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): number =>
    Number(partes.find((parte) => parte.type === tipo)?.value ?? "0");
  const year = valor("year");
  const month = valor("month");
  const day = valor("day");
  const hora = valor("hour") % 24;
  const mes = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}`;
  const dia = `${mes}-${day.toString().padStart(2, "0")}`;

  return {
    dia,
    mes,
    hora,
    // Se calcula sobre el día de calendario ya proyectado. Usar getDay()
    // directamente volvería a interpretar el instante en la zona del proceso.
    diaSemana: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** Las fechas de contrato son días canónicos YYYY-MM-DD codificados a 00:00Z. */
export function diaCanonico(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function mesCanonico(fecha: Date): string {
  return diaCanonico(fecha).slice(0, 7);
}

