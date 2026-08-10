export type MovimientoContableGrafico = {
  mes: string;
  monedaId: string;
  tipoPagoId: string | null;
  tipoPagoNombre: string;
  monto: string;
};

export type CierreContableGrafico = {
  mes: string;
  monedaId: string;
  saldoEsperado: string;
  saldoContado: string;
  diferencia: string;
};

export type GastoRecurrenteGrafico = {
  recurrenteId: string;
  monedaId: string;
  categoriaId: string;
  categoriaNombre: string;
  monto: string;
  mesInicio: string;
  mesFin: string | null;
};

export type EstadisticasContabilidadFacts = {
  movimientosEntrada: MovimientoContableGrafico[];
  cierres: CierreContableGrafico[];
  gastosRecurrentes: GastoRecurrenteGrafico[];
};

export interface EstadisticasContabilidadReader {
  read(
    gymId: string,
    range: { desde: string; hasta: string; start: Date; endExclusive: Date },
  ): Promise<EstadisticasContabilidadFacts>;
}

