import { describe, expect, test } from "bun:test";
import { EstadisticasContabilidadService } from "./estadisticas-contabilidad.service";
import type { EstadisticasContabilidadReader } from "./estadisticas-contabilidad.reader";

const facts: EstadisticasContabilidadReader = {
  async read() {
    return {
      movimientosEntrada: [
        { mes: "2026-07", monedaId: "cup", tipoPagoId: "cash", tipoPagoNombre: "Efectivo", monto: "100.00" },
        { mes: "2026-07", monedaId: "cup", tipoPagoId: "card", tipoPagoNombre: "Tarjeta", monto: "50.00" },
      ],
      cierres: [
        { mes: "2026-07", monedaId: "cup", saldoEsperado: "150.00", saldoContado: "148.00", diferencia: "-2.00" },
      ],
      gastosRecurrentes: [
        { recurrenteId: "rent", monedaId: "cup", categoriaId: "rent", categoriaNombre: "Alquiler", monto: "20.00", mesInicio: "2026-01", mesFin: null },
      ],
    };
  },
};

const treasury = {
  async get() {
    return {
      monedas: [{
        moneda_id: "cup", moneda_codigo: "CUP", entradas: "150.00",
        salidas: "35.00", neto: "115.00", estado: "CERRADO",
        cuentas: [{ cuenta_id: "box", cuenta_nombre: "Caja", entradas: "150.00" }],
      }],
      cobros_por_recepcionista: [{
        moneda_id: "cup", cobrado_por_user_id: "u1",
        cobrado_por_nombre_snapshot: "Ana", cobrado_por_rol_snapshot: "recepcionista",
        pagos: 2, clientes: 2, bruto: "150.00", cambio: "0.00",
        anulado: "0.00", neto: "150.00", historico_sin_atribuir: false,
      }],
    };
  },
};

const accrual = {
  async get() {
    return {
      estado_periodo: "PROVISIONAL", certificado: false,
      monedas: [{
        moneda_id: "cup", moneda_codigo: "CUP", ingreso_devengado_mes: "130.00",
        costo_directo_mes: "15.00", margen_directo_mes: "115.00",
        fijo_no_distribuido_mes: "10.00", margen_menos_fijo_mes: "105.00",
        gasto_devengado_mes: "25.00", resultado_operativo_devengado_mes: "80.00",
      }],
      gasto_devengado: { monedas: [{
        moneda_id: "cup", moneda_codigo: "CUP", gastos: [{
          categoria_id: "rent", categoria_nombre: "Alquiler",
          mes_pertenencia: "2026-07", estado: "PAGADO", importe: "25.00",
        }],
      }] },
    };
  },
};

const revaluation = {
  async get() {
    return {
      estado: "PROVISIONAL", moneda_base_id: "cup",
      moneda_base_codigo: "CUP", total_revaluacion: "-3.00",
    };
  },
};

describe("EstadisticasContabilidadService", () => {
  test("publica las mismas cifras por moneda y conserva trazabilidad gráfica", async () => {
    const service = new EstadisticasContabilidadService(facts, treasury, accrual, revaluation);
    const result = await service.dashboard({
      gymId: "gym-1", zona: "America/Havana", hoy: new Date("2026-07-31T00:00:00Z"),
      desde: "2026-07", hasta: "2026-07",
    });
    expect(result.periodo.meses).toEqual(["2026-07"]);
    expect(result.monedas).toHaveLength(1);
    const row = result.monedas[0].serie[0];
    expect(row.ingresos_caja).toBe("150.00");
    expect(row.ingresos_por_tipo_pago).toEqual([
      { id: "cash", nombre: "Efectivo", importe: "100.00" },
      { id: "card", nombre: "Tarjeta", importe: "50.00" },
    ]);
    expect(row.gasto_por_categoria[0].importe).toBe("25.00");
    expect(row.resultado_operativo_devengado).toBe("80.00");
    expect(row.resultado_signo).toBe("POSITIVO");
    expect(row.revaluacion_cambiaria).toBe("-3.00");
    expect(row.cierres.diferencia).toBe("-2.00");
    expect(row.cobros_por_recepcionista[0].nombre).toBe("Ana");
  });

  test("rechaza más de doce meses", async () => {
    const service = new EstadisticasContabilidadService(facts, treasury, accrual, revaluation);
    expect(service.dashboard({
      gymId: "gym-1", zona: "America/Havana", hoy: new Date("2026-07-31T00:00:00Z"),
      desde: "2025-01", hasta: "2026-07",
    })).rejects.toThrow("máximo");
  });
});

