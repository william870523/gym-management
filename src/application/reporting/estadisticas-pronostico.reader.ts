/** Hechos mínimos para E5: demanda observada diaria en la zona de la sede. */
export interface VisitasPorDia {
  dia: string;
  visitas: number;
}

export interface LecturaPronostico {
  visitasPorDia: VisitasPorDia[];
  primeraEntradaDia: string | null;
  truncado: boolean;
}

export interface EstadisticasPronosticoReader {
  leerVisitasDiarias(input: {
    gymId: string;
    zona: string;
    desdeDia: Date;
    hastaDiaExclusivo: Date;
  }): Promise<LecturaPronostico>;
}

