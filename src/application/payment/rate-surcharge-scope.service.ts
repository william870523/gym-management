import { createHash } from "crypto";
import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "../../domain/treasury-ledger-policy";
import { parseExchangeRateSurcharges } from "../../domain/exchange-rate-surcharge-policy";

export const GLOBAL_SURCHARGE_SCOPE = "GLOBAL";

export type SurchargeScopeSource = "SEDE" | "GLOBAL" | "MIXTO" | "NINGUNO";

export type SurchargeRow = {
  tipo_cambio_recargo_id: string;
  tipo_cambio_id: string;
  tipo_pago_id: string;
  gym_id: string;
  porcentaje: unknown;
  source_device?: string | null;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
  version: number;
  deleted_at?: Date | null;
};

export function surchargeScopeId(rateId: string, paymentTypeId: string, scope: string) {
  const hex = createHash("sha256")
    .update(`gymos-m3-recargo|${rateId}|${paymentTypeId}|${scope}`)
    .digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function normalizeScopedSurcharges(value: unknown, allowExplicitZero: boolean): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Los recargos deben ser un objeto { tipo_pago_id: porcentaje }.");
  }
  const normalized: Record<string, string> = {};
  for (const [rawId, rawPct] of Object.entries(value as Record<string, unknown>)) {
    const paymentTypeId = rawId.trim();
    if (!paymentTypeId || paymentTypeId.length > 191) throw new Error("El método de pago de un recargo no es válido.");
    let minor: bigint;
    try { minor = treasuryMoneyToMinor(String(rawPct ?? "")); }
    catch { throw new Error(`El porcentaje del recargo para ${paymentTypeId} debe tener hasta dos decimales.`); }
    if (minor < 0n || minor > 10000n) throw new Error(`El porcentaje del recargo para ${paymentTypeId} debe estar entre 0 y 100.`);
    if (minor === 0n && !allowExplicitZero) continue;
    normalized[paymentTypeId] = treasuryMinorToMoney(minor);
  }
  return normalized;
}

function rowPct(row: Pick<SurchargeRow, "porcentaje">) {
  return treasuryMinorToMoney(treasuryMoneyToMinor(String(row.porcentaje)));
}

export function resolveScopedSurcharges(input: { rows: SurchargeRow[]; gymId: string; legacyJson?: string | null }) {
  const legacy = parseExchangeRateSurcharges(input.legacyJson);
  const global = new Map<string, SurchargeRow>();
  const site = new Map<string, SurchargeRow>();
  for (const row of input.rows) {
    if (row.is_deleted) continue;
    if (row.gym_id === GLOBAL_SURCHARGE_SCOPE) global.set(row.tipo_pago_id, row);
    if (row.gym_id === input.gymId) site.set(row.tipo_pago_id, row);
  }
  const paymentTypeIds = new Set([...Object.keys(legacy), ...global.keys(), ...site.keys()]);
  const effective: Record<string, string> = {};
  const globalValues: Record<string, string> = { ...legacy };
  const siteOverrides: Record<string, string> = {};
  const sources: Record<string, "SEDE" | "GLOBAL"> = {};
  const versions: Record<string, number> = {};
  for (const paymentTypeId of paymentTypeIds) {
    const globalRow = global.get(paymentTypeId);
    const siteRow = site.get(paymentTypeId);
    if (globalRow) globalValues[paymentTypeId] = rowPct(globalRow);
    if (siteRow) siteOverrides[paymentTypeId] = rowPct(siteRow);
    const selected = siteRow ?? globalRow;
    const pct = selected ? rowPct(selected) : legacy[paymentTypeId];
    if (pct && treasuryMoneyToMinor(pct) > 0n) effective[paymentTypeId] = pct;
    if (selected) {
      sources[paymentTypeId] = siteRow ? "SEDE" : "GLOBAL";
      versions[paymentTypeId] = Number(selected.version);
    } else if (pct) {
      sources[paymentTypeId] = "GLOBAL";
      versions[paymentTypeId] = 0;
    }
  }
  const sourceSet = new Set(Object.values(sources));
  const source: SurchargeScopeSource = sourceSet.size === 0 ? "NINGUNO" : sourceSet.size > 1 ? "MIXTO" : sourceSet.has("SEDE") ? "SEDE" : "GLOBAL";
  return { effective, global: globalValues, site: siteOverrides, sources, versions, source };
}

export async function readRateSurchargeScope(tx: any, rate: { tipo_cambio_id: string; recargos_json?: string | null }, gymId: string) {
  const rows = tx.tipoCambioRecargo ? await tx.tipoCambioRecargo.findMany({
    where: { tipo_cambio_id: rate.tipo_cambio_id, gym_id: { in: [GLOBAL_SURCHARGE_SCOPE, gymId] } },
  }) : [];
  return resolveScopedSurcharges({ rows, gymId, legacyJson: rate.recargos_json });
}

export function effectiveSurchargeVersion(rateVersion: number, rowVersion: number | undefined) {
  if (!rowVersion) return Number(rateVersion);
  return Number(rateVersion) * 1_000_000 + Number(rowVersion);
}

export async function replaceRateSurcharges(input: { tx: any; rateId: string; scope: string; values: unknown; sourceDevice: string; nowUtc: Date }) {
  const { tx, rateId, scope, sourceDevice, nowUtc } = input;
  const values = normalizeScopedSurcharges(input.values, scope !== GLOBAL_SURCHARGE_SCOPE);
  const rate = await tx.tipoCambio.findFirst({ where: { tipo_cambio_id: rateId, is_deleted: false } });
  if (!rate) throw new Error("TipoCambio not found");
  const paymentTypeIds = Object.keys(values);
  if (paymentTypeIds.length > 0) {
    const valid = await tx.tipoPago.findMany({
      where: { tipo_pago_id: { in: paymentTypeIds }, activo: true, is_deleted: false },
      select: { tipo_pago_id: true },
    });
    if (valid.length !== paymentTypeIds.length) throw new Error("Uno de los métodos de pago no está disponible.");
  }
  const existing: SurchargeRow[] = await tx.tipoCambioRecargo.findMany({ where: { tipo_cambio_id: rateId, gym_id: scope } });
  const byPaymentType = new Map(existing.map((row) => [row.tipo_pago_id, row]));
  const changed: Array<{ operation: "INSERT" | "UPDATE" | "DELETE"; row: SurchargeRow }> = [];
  for (const [paymentTypeId, percentage] of Object.entries(values)) {
    const previous = byPaymentType.get(paymentTypeId);
    if (previous && !previous.is_deleted && rowPct(previous) === percentage) continue;
    const row = await tx.tipoCambioRecargo.upsert({
      where: { tipo_cambio_id_tipo_pago_id_gym_id: { tipo_cambio_id: rateId, tipo_pago_id: paymentTypeId, gym_id: scope } },
      create: {
        tipo_cambio_recargo_id: surchargeScopeId(rateId, paymentTypeId, scope), tipo_cambio_id: rateId,
        tipo_pago_id: paymentTypeId, gym_id: scope, porcentaje: percentage, source_device: sourceDevice,
        is_deleted: false, created_at: nowUtc, updated_at: nowUtc, version: 1, deleted_at: null,
      },
      update: { porcentaje: percentage, source_device: sourceDevice, is_deleted: false, updated_at: nowUtc, version: { increment: 1 }, deleted_at: null },
    });
    changed.push({ operation: previous ? "UPDATE" : "INSERT", row });
  }
  for (const previous of existing) {
    if (previous.is_deleted || Object.prototype.hasOwnProperty.call(values, previous.tipo_pago_id)) continue;
    const row = await tx.tipoCambioRecargo.update({
      where: { tipo_cambio_recargo_id: previous.tipo_cambio_recargo_id },
      data: { is_deleted: true, deleted_at: nowUtc, updated_at: nowUtc, source_device: sourceDevice, version: { increment: 1 } },
    });
    changed.push({ operation: "DELETE", row });
  }
  return { rate, values, changed };
}
