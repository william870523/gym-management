import type {
  EstadisticasContabilidadFacts,
  EstadisticasContabilidadReader,
} from "../../application/reporting/estadisticas-contabilidad.reader";
import { prisma } from "../db/prismaClient";

/** Dimensiones auxiliares de E4; los importes contables vienen de sus readers. */
export class PrismaEstadisticasContabilidadReader
  implements EstadisticasContabilidadReader {
  async read(
    gymId: string,
    range: { desde: string; hasta: string; start: Date; endExclusive: Date },
  ): Promise<EstadisticasContabilidadFacts> {
    const [movements, closes, recurring, paymentTypes, categories] = await Promise.all([
      prisma.tesoreriaMovimiento.findMany({
        where: {
          gym_id: gymId,
          fecha_negocio: { gte: range.start, lt: range.endExclusive },
          direccion: "ENTRADA",
          is_deleted: false,
        },
        select: {
          fecha_negocio: true,
          moneda_id: true,
          tipo_pago_id: true,
          monto: true,
        },
      }),
      prisma.tesoreriaCierre.findMany({
        where: {
          gym_id: gymId,
          fecha_negocio: { gte: range.start, lt: range.endExclusive },
          is_deleted: false,
        },
        select: {
          fecha_negocio: true,
          moneda_id: true,
          saldo_esperado: true,
          saldo_contado: true,
          diferencia: true,
        },
      }),
      prisma.gastoRecurrente.findMany({
        where: {
          gym_id: gymId,
          activo: true,
          is_deleted: false,
          mes_inicio: { lte: range.hasta },
          OR: [{ mes_fin: null }, { mes_fin: { gte: range.desde } }],
        },
        select: {
          recurrente_id: true,
          moneda_id: true,
          categoria_id: true,
          monto: true,
          mes_inicio: true,
          mes_fin: true,
        },
      }),
      prisma.tipoPago.findMany({
        where: { is_deleted: false },
        select: { tipo_pago_id: true, nombre_tipo_pago: true },
      }),
      prisma.gastoCategoria.findMany({
        where: { gym_id: gymId, is_deleted: false },
        select: { categoria_id: true, nombre: true },
      }),
    ]);
    const paymentName = new Map(
      paymentTypes.map((row) => [row.tipo_pago_id, row.nombre_tipo_pago]),
    );
    const categoryName = new Map(categories.map((row) => [row.categoria_id, row.nombre]));
    return {
      movimientosEntrada: movements.map((row) => ({
        mes: row.fecha_negocio.toISOString().slice(0, 7),
        monedaId: row.moneda_id,
        tipoPagoId: row.tipo_pago_id,
        tipoPagoNombre: row.tipo_pago_id
          ? paymentName.get(row.tipo_pago_id) ?? row.tipo_pago_id
          : "Sin medio de pago",
        monto: row.monto.toString(),
      })),
      cierres: closes.map((row) => ({
        mes: row.fecha_negocio.toISOString().slice(0, 7),
        monedaId: row.moneda_id,
        saldoEsperado: row.saldo_esperado.toString(),
        saldoContado: row.saldo_contado.toString(),
        diferencia: row.diferencia.toString(),
      })),
      gastosRecurrentes: recurring.map((row) => ({
        recurrenteId: row.recurrente_id,
        monedaId: row.moneda_id,
        categoriaId: row.categoria_id,
        categoriaNombre: categoryName.get(row.categoria_id) ?? row.categoria_id,
        monto: row.monto.toString(),
        mesInicio: row.mes_inicio,
        mesFin: row.mes_fin,
      })),
    };
  }
}

