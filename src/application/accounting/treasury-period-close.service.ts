import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  canReopenTreasuryPeriod, canSignTreasuryPeriod, computePeriodMetrics,
  computeSigningBlockers, normalizePeriodOperationId, normalizePeriodRange,
  normalizePeriodReason, TreasuryPeriodClosePolicyError,
  type NormalizedTreasuryPeriod,
} from "../../domain/treasury-period-close-policy";
import { treasuryMinorToMoney, treasuryMoneyToMinor } from "../../domain/treasury-ledger-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { resolveFrozenActor } from "./frozen-actor";
import { CompensationProfileService } from "./compensation-profile.service";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
type MonthlyDelegate = {
  summary(gymId: string, month: unknown, userId: string, role: unknown): Promise<any>;
  close(input: { gymId: string; month: unknown; operationId: unknown; reason: unknown; userId: string; role: unknown }): Promise<any>;
  reopen(input: { gymId: string; month: unknown; operationId: unknown; reason: unknown; userId: string; role: unknown }): Promise<any>;
};
export class TreasuryPeriodCloseServiceError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400, readonly blockers?: Array<{ codigo: string; cantidad: number }>) {
    super(message); this.name = "TreasuryPeriodCloseServiceError";
  }
}
const R56_CUTOFF = new Date("2026-07-26T00:00:00.000Z");
const dateText = (value: Date | string) => new Date(value).toISOString().slice(0, 10);

export class TreasuryPeriodCloseService {
  private readonly profiles = new CompensationProfileService();
  constructor(private readonly monthly: MonthlyDelegate) {}

  async summary(input: { gymId: string; desde: unknown; hasta: unknown; tipo: unknown; monedaId?: unknown; cuentaId?: unknown; userId: string; role: unknown }) {
    const period = await this.period(input.gymId, input.desde, input.hasta, input.tipo);
    if (period.tipo_periodo === "MENSUAL") return { origen_cierre: "MENSUAL", tipo_periodo: "MENSUAL", ...(await this.monthly.summary(input.gymId, period.desde.slice(0, 7), input.userId, input.role)) };
    const live = await this.buildSummary(prisma, input.gymId, period, { monedaId: this.optionalId(input.monedaId), cuentaId: this.optionalId(input.cuentaId) });
    const active = await prisma.tesoreriaCierrePeriodo.findFirst({ where: { gym_id: input.gymId, tipo_periodo: period.tipo_periodo, fecha_inicio: period.fecha_inicio, fecha_fin_exclusiva: period.fecha_fin_exclusiva, estado: "CERRADO", clave_periodo_activa: { not: null }, is_deleted: false }, orderBy: [{ ciclo_numero: "desc" }, { cerrado_at: "desc" }] });
    return { ...live, origen_cierre: "PERIODO", cierre_periodo: { estado: active ? "CERRADO" : "ABIERTO", listo_para_firmar: !active && live.bloqueadores.length === 0, capacidades: { puede_firmar: !active && live.bloqueadores.length === 0 && canSignTreasuryPeriod(input.role), puede_reabrir: Boolean(active) && canReopenTreasuryPeriod(input.role) }, ciclo_activo: active ? await this.present(input.gymId, active) : null } };
  }

  async list(input: { gymId: string; desde: unknown; hasta: unknown }) {
    const period = await this.periodForList(input.gymId, input.desde, input.hasta);
    const rows = await prisma.tesoreriaCierrePeriodo.findMany({ where: { gym_id: input.gymId, is_deleted: false, fecha_inicio: { lt: period.fecha_fin_exclusiva }, fecha_fin_exclusiva: { gt: period.fecha_inicio } }, orderBy: [{ cerrado_at: "desc" }, { ciclo_numero: "desc" }], take: 100 });
    return { desde: period.desde, hasta: period.hasta, cierres: await Promise.all(rows.map((row) => this.present(input.gymId, row))) };
  }

  async sign(input: { gymId: string; desde: unknown; hasta: unknown; tipo: unknown; operationId: unknown; reason: unknown; userId: string; role: unknown }) {
    if (!canSignTreasuryPeriod(input.role)) throw new TreasuryPeriodCloseServiceError("Su rol no puede firmar cierres por período.", 403);
    const operationId = this.policy(() => normalizePeriodOperationId(input.operationId));
    const reason = this.policy(() => normalizePeriodReason(input.reason, "cerrar"));
    const period = await this.period(input.gymId, input.desde, input.hasta, input.tipo);
    if (period.tipo_periodo === "MENSUAL") return { origen_cierre: "MENSUAL", ...(await this.monthly.close({ gymId: input.gymId, month: period.desde.slice(0, 7), operationId, reason, userId: input.userId, role: input.role })) };
    const repeated = await prisma.tesoreriaCierrePeriodo.findUnique({ where: { operacion_id: operationId } });
    if (repeated) {
      this.assertRepeated(input.gymId, repeated, period, reason);
      return { origen_cierre: "PERIODO", cierre: await this.present(input.gymId, repeated) };
    }
    const now = trustedClock.nowUtc();
    const row = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.tesoreriaCierrePeriodo.findUnique({ where: { operacion_id: operationId } });
      if (duplicate) return this.assertRepeated(input.gymId, duplicate, period, reason);
      const actor = await this.actor(tx, input.gymId, input.userId);
      const key = this.activeKey(input.gymId, period);
      if (await tx.tesoreriaCierrePeriodo.findFirst({ where: { gym_id: input.gymId, clave_periodo_activa: key, estado: "CERRADO", is_deleted: false } })) throw new TreasuryPeriodCloseServiceError("Ese período ya tiene un ciclo activo. Reábralo antes de volver a firmar.", 409);
      const live = await this.buildSummary(tx, input.gymId, period, {});
      if (live.bloqueadores.length) throw new TreasuryPeriodCloseServiceError("El período tiene incidencias que impiden firmarlo.", 409, live.bloqueadores);
      const previous = await tx.tesoreriaCierrePeriodo.findFirst({ where: { gym_id: input.gymId, tipo_periodo: period.tipo_periodo, fecha_inicio: period.fecha_inicio, fecha_fin_exclusiva: period.fecha_fin_exclusiva, is_deleted: false }, orderBy: { ciclo_numero: "desc" }, select: { ciclo_numero: true } });
      const snapshot = { version: 1, gym_id: input.gymId, timezone: live.timezone, tipo_periodo: period.tipo_periodo, fecha_inicio: period.desde, fecha_fin_exclusiva: dateText(period.fecha_fin_exclusiva), generado_at_utc: now.toISOString(), cerrado_por: { user_id: actor.userId, nombre: actor.nombre, rol: actor.rol, origen: actor.origen }, resumen_monedas: live.resumen_monedas, dias: live.dias, pagos: live.pagos, movimiento_ids: live.movimiento_ids, cierre_diario_ids: live.cierre_diario_ids, conciliacion_ids: live.conciliacion_ids };
      const snapshotJson = canonicalStringify(snapshot);
      const created = await tx.tesoreriaCierrePeriodo.create({ data: { cierre_periodo_id: randomUUID(), operacion_id: operationId, clave_periodo_activa: key, tipo_periodo: period.tipo_periodo, fecha_inicio: period.fecha_inicio, fecha_fin_exclusiva: period.fecha_fin_exclusiva, ciclo_numero: (previous?.ciclo_numero ?? 0) + 1, estado: "CERRADO", motivo_cierre: reason, cerrado_por_user_id: actor.userId, cerrado_por_nombre_snapshot: actor.nombre, cerrado_por_rol_snapshot: actor.rol, cerrado_at: now, reapertura_operacion_id: null, reapertura_motivo: null, reabierto_por_user_id: null, reabierto_por_nombre_snapshot: null, reabierto_por_rol_snapshot: null, reabierto_at: null, snapshot_version: 2, snapshot_json: snapshotJson, snapshot_sha256: this.hash(snapshotJson), is_deleted: false, created_at: now, gym_id: input.gymId, source_device: null, version: 1, updated_at: now, deleted_at: null } });
      await tx.syncLog.create({ data: { event_id: operationId, entidad: "tesoreria_cierre_periodo", operacion: "INSERT", entidad_id: created.cierre_periodo_id, gym_id: input.gymId, device_id: null, payload_json: JSON.stringify(serialize(created)) } });
      return created;
    }, { isolationLevel: "Serializable", timeout: 30_000 });
    return { origen_cierre: "PERIODO", cierre: await this.present(input.gymId, row) };
  }

  async reopen(input: { gymId: string; closeId: string; operationId: unknown; reason: unknown; userId: string; role: unknown }) {
    if (!canReopenTreasuryPeriod(input.role)) throw new TreasuryPeriodCloseServiceError("Solo administración puede reabrir un cierre por período.", 403);
    const operationId = this.policy(() => normalizePeriodOperationId(input.operationId));
    const reason = this.policy(() => normalizePeriodReason(input.reason, "reabrir"));
    const monthly = await prisma.tesoreriaCierreMensual.findFirst({ where: { cierre_mensual_id: input.closeId, gym_id: input.gymId, is_deleted: false } });
    if (monthly) return { origen_cierre: "MENSUAL", ...(await this.monthly.reopen({ gymId: input.gymId, month: monthly.mes, operationId, reason, userId: input.userId, role: input.role })) };
    const now = trustedClock.nowUtc();
    const row = await prisma.$transaction(async (tx) => {
      const close = await tx.tesoreriaCierrePeriodo.findFirst({ where: { cierre_periodo_id: input.closeId, gym_id: input.gymId, is_deleted: false } });
      if (!close) throw new TreasuryPeriodCloseServiceError("No se encontró el cierre por período.", 404);
      if (close.reapertura_operacion_id === operationId) return close;
      if (close.estado !== "CERRADO" || !close.clave_periodo_activa) throw new TreasuryPeriodCloseServiceError("El ciclo ya está reabierto.", 409);
      const actor = await this.actor(tx, input.gymId, input.userId);
      const updated = await tx.tesoreriaCierrePeriodo.update({ where: { cierre_periodo_id: close.cierre_periodo_id }, data: { estado: "REABIERTO", clave_periodo_activa: null, reapertura_operacion_id: operationId, reapertura_motivo: reason, reabierto_por_user_id: actor.userId, reabierto_por_nombre_snapshot: actor.nombre, reabierto_por_rol_snapshot: actor.rol, reabierto_at: now, version: { increment: 1 }, updated_at: now } });
      await tx.syncLog.create({ data: { event_id: operationId, entidad: "tesoreria_cierre_periodo", operacion: "UPDATE", entidad_id: updated.cierre_periodo_id, gym_id: input.gymId, device_id: null, payload_json: JSON.stringify(serialize(updated)) } });
      return updated;
    }, { isolationLevel: "Serializable", timeout: 30_000 });
    return { origen_cierre: "PERIODO", cierre: await this.present(input.gymId, row) };
  }

  private async buildSummary(db: Db, gymId: string, period: NormalizedTreasuryPeriod, filters: { monedaId?: string | null; cuentaId?: string | null }) {
    const movementWhere: any = { gym_id: gymId, is_deleted: false, fecha_negocio: { gte: period.fecha_inicio, lt: period.fecha_fin_exclusiva } };
    if (filters.monedaId) movementWhere.moneda_id = filters.monedaId; if (filters.cuentaId) movementWhere.cuenta_id = filters.cuentaId;
    const [movements, closes, reconciliations, requests, accounts, currencies, monthCloses] = await Promise.all([
      db.tesoreriaMovimiento.findMany({ where: movementWhere, orderBy: [{ fecha_negocio: "asc" }, { ocurrido_at: "asc" }, { movimiento_id: "asc" }] }),
      db.tesoreriaCierre.findMany({ where: { gym_id: gymId, is_deleted: false, fecha_negocio: { gte: period.fecha_inicio, lt: period.fecha_fin_exclusiva }, ...(filters.cuentaId ? { cuenta_id: filters.cuentaId } : {}), ...(filters.monedaId ? { moneda_id: filters.monedaId } : {}) } }),
      db.tesoreriaConciliacion.findMany({ where: { gym_id: gymId, is_deleted: false, fecha_negocio: { gte: period.fecha_inicio, lt: period.fecha_fin_exclusiva } } }),
      db.tesoreriaCierreSolicitud.findMany({ where: { gym_id: gymId, is_deleted: false, fecha_negocio: { gte: period.fecha_inicio, lt: period.fecha_fin_exclusiva } } }),
      db.cuenta.findMany({ where: { gym_id: gymId, is_deleted: false, ...(filters.cuentaId ? { cuenta_id: filters.cuentaId } : {}) }, orderBy: { nombre_cuenta: "asc" } }),
      db.moneda.findMany({ where: { is_deleted: false, ...(filters.monedaId ? { moneda_id: filters.monedaId } : {}) } }),
      db.tesoreriaCierreMensual.findMany({ where: { gym_id: gymId, estado: "CERRADO", bloqueo_clave: { not: null }, is_deleted: false, fecha_desde: { lt: period.fecha_fin_exclusiva }, fecha_hasta_exclusiva: { gt: period.fecha_inicio } } }),
    ]);
    if (filters.cuentaId && !accounts.length) throw new TreasuryPeriodCloseServiceError("La cuenta no pertenece a este gimnasio.", 404);
    if (filters.monedaId && !currencies.length) throw new TreasuryPeriodCloseServiceError("La moneda no existe.", 404);
    const reversalIds = movements.filter((row) => row.origen_tipo === "PAGO_REVERSION").map((row) => row.origen_id);
    const reversals = reversalIds.length ? await db.pagoReversion.findMany({ where: { reversion_id: { in: reversalIds } } }) : [];
    const paymentByReversal = new Map(reversals.map((row) => [row.reversion_id, row.pago_cliente_id]));
    const paymentIdFor = (row: any) => row.origen_tipo === "PAGO_REVERSION" ? paymentByReversal.get(row.origen_id) ?? null : (["PAGO_CLIENTE", "PAGO_CAMBIO"].includes(row.origen_tipo) ? row.origen_id : null);
    const paymentIds = [...new Set(movements.map(paymentIdFor).filter(Boolean))] as string[];
    const payments = paymentIds.length ? await db.pagoCliente.findMany({ where: { pago_cliente_id: { in: paymentIds } }, orderBy: [{ fecha: "asc" }, { pago_cliente_id: "asc" }] }) : [];
    const scopedPayments = payments.filter((row) => row.gym_id === gymId); const paymentById = new Map(scopedPayments.map((row) => [row.pago_cliente_id, row]));
    const metricRows = movements.map((row) => { const paymentId = paymentIdFor(row); const payment = paymentId ? paymentById.get(paymentId) : null; return { movimiento_id: row.movimiento_id, moneda_id: row.moneda_id, cuenta_id: row.cuenta_id, fecha_negocio: dateText(row.fecha_negocio), direccion: row.direccion as "ENTRADA" | "SALIDA", monto: row.monto.toString(), origen_tipo: row.origen_tipo, origen_id: row.origen_id, contramovimiento_de_id: row.contramovimiento_de_id, pago_cliente_id: paymentId, cliente_id: payment?.ci ?? null, cobrado_por_user_id: row.cobrado_por_user_id }; });
    const metricCloses = closes.map((row) => ({ cuenta_id: row.cuenta_id, fecha_negocio: dateText(row.fecha_negocio) })); const metrics = computePeriodMetrics(metricRows, metricCloses);
    const accountById = new Map(accounts.map((row) => [row.cuenta_id, row])); const currencyById = new Map(currencies.map((row) => [row.moneda_id, row])); const closeKeys = new Set(metricCloses.map((row) => `${row.cuenta_id}|${row.fecha_negocio}`));
    const paymentRows = scopedPayments.map((payment) => ({ pago_cliente_id: payment.pago_cliente_id, ocurrido_at_utc: payment.fecha.toISOString(), ci: payment.ci, plan_id: payment.id_planes_pago, plan_codigo: payment.plan_codigo_snapshot, cuota: payment.cuota_sufijo_snapshot, cobrador: payment.cobrado_por_user_id ? { user_id: payment.cobrado_por_user_id, nombre: payment.cobrado_por_nombre_snapshot, rol: payment.cobrado_por_rol_snapshot, origen: payment.cobrado_por_origen } : { grupo: "SIN_ATRIBUIR_HISTORICO" }, reverso: (() => { const reversal = reversals.find((row) => row.pago_cliente_id === payment.pago_cliente_id); return reversal ? { reversion_id: reversal.reversion_id, anulado_por_user_id: reversal.registrada_por_user_id, anulado_por_nombre: reversal.registrada_por_nombre_snapshot, registrado_at_utc: reversal.registrada_at.toISOString() } : null; })(), detalles: movements.filter((row) => paymentIdFor(row) === payment.pago_cliente_id).map((row) => ({ movimiento_id: row.movimiento_id, cuenta_id: row.cuenta_id, moneda_id: row.moneda_id, direccion: row.direccion, monto: row.monto.toString(), tipo_pago_id: row.tipo_pago_id, origen_tipo: row.origen_tipo })).sort((a, b) => a.movimiento_id.localeCompare(b.movimiento_id)) }));
    const summaries = metrics.map((metric) => {
      const rows = movements.filter((row) => row.moneda_id === metric.moneda_id); const related = (row: any) => Boolean(paymentIdFor(row));
      const otherIn = rows.filter((row) => row.direccion === "ENTRADA" && !related(row)).reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n); const otherOut = rows.filter((row) => row.direccion === "SALIDA" && !related(row)).reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n);
      // M4b — el efectivo cobrado por cuenta de otra sede o de la cadena. Está
      // en la caja y cuenta en el arqueo, pero no es ingreso de esta sede
      // (docs/MULTI_SEDE.md §5.3). Se saca de «otras entradas» a una línea con
      // nombre porque de ella sale una deuda que alguien va a reclamar: dentro
      // de un cajón genérico nadie la va a buscar.
      const ajenoIn = rows.filter((row) => row.origen_tipo === "COBRO_CUENTA_AJENA" && row.direccion === "ENTRADA").reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n); const ajenoOut = rows.filter((row) => row.origen_tipo === "COBRO_CUENTA_AJENA" && row.direccion === "SALIDA").reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n);
      const accountRows = accounts.filter((account) => account.moneda_id === metric.moneda_id).map((account) => { const own = rows.filter((row) => row.cuenta_id === account.cuenta_id); const entries = own.filter((row) => row.direccion === "ENTRADA").reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n); const exits = own.filter((row) => row.direccion === "SALIDA").reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n); const days = [...new Set(own.map((row) => dateText(row.fecha_negocio)))]; return { cuenta_id: account.cuenta_id, nombre: account.nombre_cuenta, dias_actividad: days.length, dias_cerrados: days.filter((day) => closeKeys.has(`${account.cuenta_id}|${day}`)).length, entradas: treasuryMinorToMoney(entries), salidas: treasuryMinorToMoney(exits), neto: treasuryMinorToMoney(entries - exits), cierres_diarios: closes.filter((close) => close.cuenta_id === account.cuenta_id).map((close) => close.cierre_id).sort() }; }).filter((row) => row.dias_actividad > 0);
      const groups = new Map<string, { user_id: string | null; nombre: string; rol: string | null; origen: string | null; cobros: Set<string>; clientes: Set<string>; bruto: bigint; cambio: bigint; anulaciones: bigint }>();
      for (const row of rows.filter(related)) { const paymentId = paymentIdFor(row)!; const payment = paymentById.get(paymentId); const key = row.cobrado_por_user_id ?? "SIN_ATRIBUIR_HISTORICO"; const group = groups.get(key) ?? { user_id: row.cobrado_por_user_id, nombre: row.cobrado_por_nombre_snapshot ?? "Sin atribuir · histórico", rol: row.cobrado_por_rol_snapshot, origen: row.cobrado_por_origen, cobros: new Set<string>(), clientes: new Set<string>(), bruto: 0n, cambio: 0n, anulaciones: 0n }; group.cobros.add(paymentId); if (payment?.ci) group.clientes.add(payment.ci); const amount = treasuryMoneyToMinor(row.monto.toString()); if (row.origen_tipo === "PAGO_CLIENTE" && row.direccion === "ENTRADA") group.bruto += amount; else if (row.origen_tipo === "PAGO_CAMBIO" && row.direccion === "SALIDA") group.cambio += amount; else if (row.origen_tipo === "PAGO_REVERSION") group.anulaciones += row.direccion === "SALIDA" ? amount : -amount; groups.set(key, group); }
      const collectors = [...groups.values()].map((group) => ({ user_id: group.user_id, nombre: group.nombre, rol: group.rol, origen: group.origen, cobros_cantidad_distinta: group.cobros.size, clientes_cantidad_distinta: group.clientes.size, cobro_bruto: treasuryMinorToMoney(group.bruto), cambio_entregado: treasuryMinorToMoney(group.cambio), anulaciones: treasuryMinorToMoney(group.anulaciones), cobro_neto: treasuryMinorToMoney(group.bruto - group.cambio - group.anulaciones) })).sort((a, b) => String(a.user_id ?? "").localeCompare(String(b.user_id ?? "")));
      return { ...metric, codigo: currencyById.get(metric.moneda_id)?.codigo ?? metric.moneda_id, otras_entradas: treasuryMinorToMoney(otherIn), otras_salidas: treasuryMinorToMoney(otherOut), cobrado_cuenta_ajena_entradas: treasuryMinorToMoney(ajenoIn), cobrado_cuenta_ajena_salidas: treasuryMinorToMoney(ajenoOut), cobrado_cuenta_ajena_neto: treasuryMinorToMoney(ajenoIn - ajenoOut), cuentas: accountRows, cobradores: collectors };
    });
    const reconciled = new Set(reconciliations.flatMap((row) => this.ids(row.movimiento_ids_json))); let late = 0, invalid = 0;
    for (const close of closes) { const snapshot = this.parse(close.snapshot_json); if (!snapshot) { invalid++; continue; } const included = new Set<string>(Array.isArray(snapshot.movimiento_ids) ? snapshot.movimiento_ids.map(String) : []); late += movements.filter((row) => row.cuenta_id === close.cuenta_id && dateText(row.fecha_negocio) === dateText(close.fecha_negocio) && !included.has(row.movimiento_id) && !reconciled.has(row.movimiento_id)).length; }
    invalid += reconciliations.filter((row) => !this.parse(row.snapshot_json)).length; const accountDays = new Set(movements.filter((row) => row.cuenta_id).map((row) => `${row.cuenta_id}|${dateText(row.fecha_negocio)}`));
    const blockers = computeSigningBlockers({ CUENTA_DIA_SIN_CIERRE: [...accountDays].filter((key) => !closeKeys.has(key)).length, SOLICITUD_ARQUEO_PENDIENTE: requests.filter((row) => row.estado === "PENDIENTE").length, MOVIMIENTO_SIN_CUENTA: movements.filter((row) => !row.cuenta_id).length, MOVIMIENTO_REQUIERE_REVISION: movements.filter((row) => row.requiere_revision).length, MOVIMIENTO_TARDIO_SIN_CONCILIAR: late, INTEGRIDAD_CIERRE_O_CONCILIACION_INVALIDA: invalid, CIERRE_MENSUAL_INTEGRO_NO_VERIFICABLE: monthCloses.filter((row) => this.hash(row.resumen_snapshot_json) !== row.resumen_sha256).length, PAGO_NUEVO_SIN_COBRADOR: scopedPayments.filter((row) => !row.cobrado_por_user_id && new Date(row.created_at ?? row.fecha) >= R56_CUTOFF).length, SYNC_PENDIENTE: 0, REFERENCIA_OTRO_GIMNASIO: movements.filter((row) => row.cuenta_id && !accountById.has(row.cuenta_id)).length + payments.filter((row) => row.gym_id !== gymId).length });
    const days = [...new Set(movements.map((row) => dateText(row.fecha_negocio)))].sort().map((day) => ({ fecha_negocio: day, monedas: summaries.map((currency) => { const rows = movements.filter((row) => dateText(row.fecha_negocio) === day && row.moneda_id === currency.moneda_id); const entries = rows.filter((row) => row.direccion === "ENTRADA").reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n); const exits = rows.filter((row) => row.direccion === "SALIDA").reduce((sum, row) => sum + treasuryMoneyToMinor(row.monto.toString()), 0n); return { moneda_id: currency.moneda_id, codigo: currency.codigo, entradas: treasuryMinorToMoney(entries), salidas: treasuryMinorToMoney(exits), neto: treasuryMinorToMoney(entries - exits) }; }).filter((row) => row.entradas !== "0.00" || row.salidas !== "0.00"), cierre_ids: closes.filter((row) => dateText(row.fecha_negocio) === day).map((row) => row.cierre_id).sort(), conciliacion_ids: reconciliations.filter((row) => dateText(row.fecha_negocio) === day).map((row) => row.conciliacion_id).sort() }));
    const gym = await db.gym.findUnique({ where: { gym_id: gymId }, select: { timezone: true } }); if (!gym) throw new TreasuryPeriodCloseServiceError("No se encontró la sede autenticada.", 404);
    return { tipo_periodo: period.tipo_periodo, desde: period.desde, hasta: period.hasta, fecha_fin_exclusiva: dateText(period.fecha_fin_exclusiva), dias_cantidad: period.dias, timezone: gym.timezone, resumen_monedas: summaries, dias: days, pagos: paymentRows, bloqueadores: blockers, movimiento_ids: movements.map((row) => row.movimiento_id).sort(), cierre_diario_ids: closes.map((row) => row.cierre_id).sort(), conciliacion_ids: reconciliations.map((row) => row.conciliacion_id).sort() };
  }

  private async present(gymId: string, row: any) { const integrity = this.hash(row.snapshot_json) === row.snapshot_sha256; const snapshot = this.parse(row.snapshot_json); const current = await prisma.tesoreriaMovimiento.findMany({ where: { gym_id: gymId, is_deleted: false, fecha_negocio: { gte: row.fecha_inicio, lt: row.fecha_fin_exclusiva } }, select: { movimiento_id: true } }); const signed = new Set<string>(Array.isArray(snapshot?.movimiento_ids) ? snapshot.movimiento_ids.map(String) : []); const currentIds = new Set(current.map((item) => item.movimiento_id)); const changed = signed.size !== currentIds.size || [...signed].some((id) => !currentIds.has(id)); return { cierre_periodo_id: row.cierre_periodo_id, tipo_periodo: row.tipo_periodo, desde: dateText(row.fecha_inicio), hasta: dateText(new Date(row.fecha_fin_exclusiva.getTime() - 86_400_000)), ciclo_numero: row.ciclo_numero, estado: row.estado, motivo_cierre: row.motivo_cierre, cerrado_por_user_id: row.cerrado_por_user_id, cerrado_por_nombre: row.cerrado_por_nombre_snapshot, cerrado_por_rol: row.cerrado_por_rol_snapshot, cerrado_at: row.cerrado_at, reapertura_motivo: row.reapertura_motivo, reabierto_por_user_id: row.reabierto_por_user_id, reabierto_por_nombre: row.reabierto_por_nombre_snapshot, reabierto_por_rol: row.reabierto_por_rol_snapshot, reabierto_at: row.reabierto_at, snapshot_version: row.snapshot_version, snapshot_sha256: row.snapshot_sha256, integridad_hash: integrity, estado_integridad: !integrity ? "INVALIDA" : changed ? "REQUIERE_CONCILIACION" : "VIGENTE" }; }
  private async period(gymId: string, desde: unknown, hasta: unknown, tipo: unknown) { const today = await prisma.$transaction((tx) => this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())); return this.policy(() => normalizePeriodRange({ desde, hasta, tipo, fechaActualNegocio: dateText(today) })); }
  private async periodForList(gymId: string, desde: unknown, hasta: unknown) { try { return await this.period(gymId, desde, hasta, "PERSONALIZADO"); } catch (error) { if (error instanceof TreasuryPeriodCloseServiceError && error.message.includes("mes natural")) return this.period(gymId, desde, hasta, "MENSUAL"); throw error; } }
  private optionalId(value: unknown) { const id = String(value ?? "").trim(); return id || null; }
  private activeKey(gymId: string, period: NormalizedTreasuryPeriod) { return `${gymId}|${period.tipo_periodo}|${period.desde}|${dateText(period.fecha_fin_exclusiva)}`; }
  private async actor(tx: Tx, gymId: string, userId: string) { try { const actor = await resolveFrozenActor(tx as any, { userId, gymId }); if (actor.origen === "SYSTEM") throw new Error("system"); return actor; } catch { throw new TreasuryPeriodCloseServiceError("No se pudo revalidar la identidad operadora.", 503); } }
  private assertRepeated(gymId: string, row: any, period: NormalizedTreasuryPeriod, reason: string) { if (row.gym_id !== gymId || row.tipo_periodo !== period.tipo_periodo || row.fecha_inicio.getTime() !== period.fecha_inicio.getTime() || row.fecha_fin_exclusiva.getTime() !== period.fecha_fin_exclusiva.getTime() || row.motivo_cierre !== reason) throw new TreasuryPeriodCloseServiceError("Ese identificador de operación ya fue usado para otro cierre.", 409); return row; }
  private ids(value: string) { const parsed = this.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; }
  private parse(value: string) { try { return JSON.parse(value); } catch { return null; } }
  private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
  private policy<T>(callback: () => T): T { try { return callback(); } catch (error) { if (error instanceof TreasuryPeriodClosePolicyError) throw new TreasuryPeriodCloseServiceError(error.message, 400); throw error; } }
}
function canonicalValue(value: any): any { const serialized = serialize(value); if (Array.isArray(serialized)) return serialized.map(canonicalValue); if (serialized && typeof serialized === "object" && !(serialized instanceof Date)) return Object.fromEntries(Object.keys(serialized).sort().map((key) => [key, canonicalValue((serialized as any)[key])])); return serialized instanceof Date ? serialized.toISOString() : serialized; }
export function canonicalStringify(value: unknown) { return JSON.stringify(canonicalValue(value)); }
export function asTreasuryPeriodCloseError(error: unknown) { return error instanceof TreasuryPeriodCloseServiceError ? error : error instanceof TreasuryPeriodClosePolicyError ? new TreasuryPeriodCloseServiceError(error.message, 400) : null; }
