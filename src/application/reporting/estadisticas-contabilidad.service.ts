import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "../../domain/treasury-ledger-policy";
import type {
  EstadisticasContabilidadFacts,
  EstadisticasContabilidadReader,
} from "./estadisticas-contabilidad.reader";

type CanonicalMonthlyReader = {
  get(input: { gymId: string; month: string }): Promise<Record<string, any>>;
};

export class ConsultaContabilidadGraficaInvalida extends Error {}

/**
 * E4 no define contabilidad nueva: proyecta, por mes y moneda, los contratos
 * canónicos de Tesorería, R4.6 y R5.5. El lector auxiliar solo aporta las
 * dimensiones que esos informes no publican (medio de pago, arqueo y plantilla
 * recurrente); nunca vuelve a calcular margen, devengo o revaluación.
 */
export class EstadisticasContabilidadService {
  constructor(
    private readonly facts: EstadisticasContabilidadReader,
    private readonly treasury: CanonicalMonthlyReader,
    private readonly accrual: CanonicalMonthlyReader,
    private readonly revaluation: CanonicalMonthlyReader,
  ) {}

  async dashboard(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    desde?: unknown;
    hasta?: unknown;
  }) {
    if (!input.gymId.trim()) {
      throw new ConsultaContabilidadGraficaInvalida(
        "No se pudo determinar el gimnasio del informe.",
      );
    }
    const range = parseRange(input.desde, input.hasta, input.hoy);
    const meses = monthsBetween(range.desde, range.hasta);
    const [facts, reports] = await Promise.all([
      this.facts.read(input.gymId, range),
      Promise.all(meses.map(async (mes) => {
        const [tesoreria, devengo, revaluacion] = await Promise.all([
          this.treasury.get({ gymId: input.gymId, month: mes }),
          this.accrual.get({ gymId: input.gymId, month: mes }),
          this.revaluation.get({ gymId: input.gymId, month: mes }),
        ]);
        return { mes, tesoreria, devengo, revaluacion };
      })),
    ]);

    const currencyCodes = new Map<string, string>();
    const byCurrency = new Map<string, Record<string, any>[]>();
    for (const report of reports) {
      const rows = this.monthRows(report, facts, currencyCodes);
      for (const row of rows) {
        const list = byCurrency.get(row.moneda_id) ?? [];
        list.push(row);
        byCurrency.set(row.moneda_id, list);
      }
    }

    return {
      naturaleza: "CONTABILIDAD_GRAFICA_CANONICA",
      zona: input.zona,
      fecha_corte: input.hoy.toISOString().slice(0, 10),
      periodo: { desde: range.desde, hasta: range.hasta, meses },
      monedas: [...byCurrency.entries()]
        .map(([monedaId, serie]) => ({
          moneda_id: monedaId,
          moneda_codigo: currencyCodes.get(monedaId) ?? monedaId,
          serie,
        }))
        .sort((a, b) => a.moneda_codigo.localeCompare(b.moneda_codigo)),
      definiciones: {
        ingresos_caja:
          "Entradas del libro de Tesorería; la composición por medio de pago reconstruye exactamente ese total.",
        margen:
          "Ingreso devengado menos costo directo; el fijo no distribuido se muestra antes del gasto gobernado.",
        resultado_devengado:
          "Margen menos fijo y menos gasto gobernado del mes. No es utilidad fiscal ni contable.",
        cierres:
          "Suma de saldos esperados, contados y diferencias de los arqueos firmados del mes, siempre dentro de una moneda.",
        revaluacion:
          "Diferencia de valoración R5.5 en moneda base; es lectura y no crea asiento contable.",
      },
      advertencias: [
        "No se convierten ni se suman monedas diferentes.",
        "E4 no recalcula cifras contables: si una fuente canónica está provisional, la gráfica también lo indica.",
        "Cada gráfica tiene debajo los mismos valores en tabla para lectura y exportación verificable.",
      ],
    };
  }

  private monthRows(
    report: {
      mes: string;
      tesoreria: Record<string, any>;
      devengo: Record<string, any>;
      revaluacion: Record<string, any>;
    },
    facts: EstadisticasContabilidadFacts,
    currencyCodes: Map<string, string>,
  ) {
    const treasuryRows = rowsByCurrency(report.tesoreria.monedas, currencyCodes);
    const accrualRows = rowsByCurrency(report.devengo.monedas, currencyCodes);
    const expenseRows = rowsByCurrency(
      report.devengo.gasto_devengado?.monedas,
      currencyCodes,
    );
    const paymentRows = facts.movimientosEntrada.filter((row) => row.mes === report.mes);
    const closeRows = facts.cierres.filter((row) => row.mes === report.mes);
    const recurringRows = facts.gastosRecurrentes.filter((row) =>
      row.mesInicio <= report.mes && (row.mesFin == null || row.mesFin >= report.mes)
    );
    const ids = new Set<string>([
      ...treasuryRows.keys(),
      ...accrualRows.keys(),
      ...expenseRows.keys(),
      ...paymentRows.map((row) => row.monedaId),
      ...closeRows.map((row) => row.monedaId),
      ...recurringRows.map((row) => row.monedaId),
    ]);
    const baseCurrencyId = String(report.revaluacion.moneda_base_id ?? "").trim();
    if (baseCurrencyId) {
      ids.add(baseCurrencyId);
      currencyCodes.set(
        baseCurrencyId,
        String(report.revaluacion.moneda_base_codigo ?? baseCurrencyId),
      );
    }

    return [...ids].map((currencyId) => {
      const treasury = treasuryRows.get(currencyId) ?? {};
      const accrual = accrualRows.get(currencyId) ?? {};
      const expense = expenseRows.get(currencyId) ?? {};
      const payments = paymentRows.filter((row) => row.monedaId === currencyId);
      const closes = closeRows.filter((row) => row.monedaId === currencyId);
      const recurring = recurringRows.filter((row) => row.monedaId === currencyId);
      const paymentComposition = groupMoney(
        payments,
        (row) => row.tipoPagoId ?? "SIN_TIPO",
        (row) => row.tipoPagoNombre || "Sin medio de pago",
        (row) => row.monto,
      );
      assertSameMoney(
        String(treasury.entradas ?? "0.00"),
        paymentComposition.reduce((sum, row) => sum + treasuryMoneyToMinor(row.importe), 0n),
        `${report.mes}/${currencyId}: entradas por medio de pago`,
      );
      const accountComposition = asArray(treasury.cuentas).map((row) => ({
        cuenta_id: String(row.cuenta_id ?? "SIN_CUENTA"),
        cuenta_nombre: String(row.cuenta_nombre ?? "Sin cuenta"),
        importe: money(row.entradas),
      }));
      const categories = groupMoney(
        asArray(expense.gastos).filter((row) =>
          String(row.mes_pertenencia ?? "") === report.mes &&
          String(row.estado ?? "") !== "ANULADO"
        ),
        (row) => String(row.categoria_id ?? "SIN_CATEGORIA"),
        (row) => String(row.categoria_nombre ?? "Sin categoría"),
        (row) => row.importe,
      );
      const recurringCategories = groupMoney(
        recurring,
        (row) => row.categoriaId,
        (row) => row.categoriaNombre,
        (row) => row.monto,
      ).map((row) => ({ ...row, plantillas: recurring.filter((item) => item.categoriaId === row.id).length }));
      const closeSummary = sumCloses(closes);
      const collectors = asArray(report.tesoreria.cobros_por_recepcionista)
        .filter((row) => String(row.moneda_id ?? "") === currencyId)
        .map((row) => ({
          user_id: row.cobrado_por_user_id == null ? null : String(row.cobrado_por_user_id),
          nombre: String(row.cobrado_por_nombre_snapshot ?? "Sin atribuir · histórico"),
          rol: row.cobrado_por_rol_snapshot == null ? null : String(row.cobrado_por_rol_snapshot),
          historico_sin_atribuir: row.historico_sin_atribuir === true,
          pagos: Number(row.pagos ?? 0),
          clientes: Number(row.clientes ?? 0),
          bruto: money(row.bruto),
          cambio: money(row.cambio),
          anulado: money(row.anulado),
          neto: money(row.neto),
        }));
      const result = money(accrual.resultado_operativo_devengado_mes);
      return {
        moneda_id: currencyId,
        moneda_codigo: currencyCodes.get(currencyId) ?? currencyId,
        mes: report.mes,
        ingresos_caja: money(treasury.entradas),
        egresos_caja: money(treasury.salidas),
        neto_caja: money(treasury.neto),
        ingresos_por_tipo_pago: paymentComposition,
        ingresos_por_cuenta: accountComposition,
        gasto_devengado: money(accrual.gasto_devengado_mes),
        gasto_por_categoria: categories,
        gasto_recurrente_previsto: recurringCategories,
        margen_directo: money(accrual.margen_directo_mes),
        fijo_no_distribuido: money(accrual.fijo_no_distribuido_mes),
        margen_menos_fijo: money(accrual.margen_menos_fijo_mes),
        resultado_operativo_devengado: result,
        resultado_signo: sign(result),
        revaluacion_cambiaria: baseCurrencyId === currencyId
          ? money(report.revaluacion.total_revaluacion)
          : "0.00",
        cierres: closeSummary,
        cobros_por_recepcionista: collectors,
        estado: {
          tesoreria: treasury.estado ?? null,
          devengo: String(report.devengo.estado_periodo ?? ""),
          certificado: report.devengo.certificado === true,
          revaluacion: String(report.revaluacion.estado ?? ""),
        },
      };
    });
  }
}

function parseRange(desde: unknown, hasta: unknown, today: Date) {
  const current = today.toISOString().slice(0, 7);
  const rawDesde = String(desde ?? "").trim();
  const rawHasta = String(hasta ?? "").trim();
  if ((rawDesde && !rawHasta) || (!rawDesde && rawHasta)) {
    throw new ConsultaContabilidadGraficaInvalida(
      "desde y hasta deben enviarse juntos en formato AAAA-MM.",
    );
  }
  const end = rawHasta ? monthValue(rawHasta, "hasta") : current;
  const start = rawDesde ? monthValue(rawDesde, "desde") : shiftMonth(end, -5);
  if (start > end) {
    throw new ConsultaContabilidadGraficaInvalida("desde no puede ser posterior a hasta.");
  }
  const months = monthsBetween(start, end);
  if (months.length > 12) {
    throw new ConsultaContabilidadGraficaInvalida("El período máximo es de 12 meses.");
  }
  const startDate = new Date(`${start}-01T00:00:00.000Z`);
  const endExclusive = new Date(`${shiftMonth(end, 1)}-01T00:00:00.000Z`);
  return { desde: start, hasta: end, start: startDate, endExclusive };
}

function monthValue(value: string, field: string) {
  const candidate = /^\d{4}-\d{2}(?:-\d{2})?$/.test(value) ? value.slice(0, 7) : "";
  const month = Number(candidate.slice(5, 7));
  if (!candidate || month < 1 || month > 12) {
    throw new ConsultaContabilidadGraficaInvalida(`${field} debe usar AAAA-MM.`);
  }
  return candidate;
}

function shiftMonth(month: string, delta: number) {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

function monthsBetween(start: string, end: string) {
  const result: string[] = [];
  for (let cursor = start; cursor <= end; cursor = shiftMonth(cursor, 1)) result.push(cursor);
  return result;
}

function rowsByCurrency(value: unknown, codes: Map<string, string>) {
  const map = new Map<string, Record<string, any>>();
  for (const row of asArray(value)) {
    const id = String(row.moneda_id ?? "").trim();
    if (!id) continue;
    map.set(id, row);
    codes.set(id, String(row.moneda_codigo ?? id));
  }
  return map;
}

function asArray(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value as Record<string, any>[] : [];
}

function money(value: unknown) {
  const text = String(value ?? "0.00").trim() || "0.00";
  return treasuryMinorToMoney(treasuryMoneyToMinor(text));
}

function groupMoney<T>(
  rows: T[],
  id: (row: T) => string,
  label: (row: T) => string,
  amount: (row: T) => unknown,
) {
  const groups = new Map<string, { id: string; nombre: string; total: bigint }>();
  for (const row of rows) {
    const key = id(row);
    const group = groups.get(key) ?? { id: key, nombre: label(row), total: 0n };
    group.total += treasuryMoneyToMinor(money(amount(row)));
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((row) => ({ id: row.id, nombre: row.nombre, importe: treasuryMinorToMoney(row.total) }))
    .sort((a, b) => {
      const left = treasuryMoneyToMinor(a.importe);
      const right = treasuryMoneyToMinor(b.importe);
      if (left === right) return a.nombre.localeCompare(b.nombre);
      return right > left ? 1 : -1;
    });
}

function sumCloses(rows: EstadisticasContabilidadFacts["cierres"]) {
  const sum = (field: "saldoEsperado" | "saldoContado" | "diferencia") =>
    rows.reduce((total, row) => total + treasuryMoneyToMinor(row[field]), 0n);
  return {
    cantidad: rows.length,
    saldo_esperado: treasuryMinorToMoney(sum("saldoEsperado")),
    saldo_contado: treasuryMinorToMoney(sum("saldoContado")),
    diferencia: treasuryMinorToMoney(sum("diferencia")),
  };
}

function sign(value: string) {
  const minor = treasuryMoneyToMinor(value);
  return minor > 0n ? "POSITIVO" : minor < 0n ? "NEGATIVO" : "NEUTRO";
}

function assertSameMoney(expected: string, actual: bigint, source: string) {
  if (treasuryMoneyToMinor(money(expected)) !== actual) {
    throw new Error(`E4_INVARIANTE: ${source} no reconstruye el total canónico.`);
  }
}
