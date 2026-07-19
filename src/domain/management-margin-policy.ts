import {
  buildMembershipRevenueReport,
  type MembershipRevenueSnapshot,
} from "./membership-revenue-policy";
import {
  buildTrainerServiceCostReport,
  type TrainerServiceCostSnapshot,
} from "./trainer-service-cost-policy";
import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

export class ManagementMarginPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementMarginPolicyError";
  }
}

type MarginBucket = {
  ingresoMes: bigint;
  ingresoAcumulado: bigint;
  costoMes: bigint;
  costoAcumulado: bigint;
  membresias: Set<string>;
  clientes: Set<string>;
  planes: Set<string>;
  requiresReview: boolean;
};

type TrainerBucket = MarginBucket & {
  trainerName: string;
  fijoMes: bigint;
  fijoAcumulado: bigint;
  compartidas: Set<string>;
  costoCompartidoMes: bigint;
  costoCompartidoAcumulado: bigint;
  costoSinIngresoMes: bigint;
  costoSinIngresoAcumulado: bigint;
};

export function buildManagementMarginReport(input: {
  month: unknown;
  currentBusinessDate: Date;
  memberships: MembershipRevenueSnapshot[];
  costs: TrainerServiceCostSnapshot[];
}) {
  const revenue = buildMembershipRevenueReport({
    month: input.month,
    currentBusinessDate: input.currentBusinessDate,
    memberships: input.memberships,
  });
  const cost = buildTrainerServiceCostReport({
    month: input.month,
    currentBusinessDate: input.currentBusinessDate,
    costs: input.costs,
  });

  const currencyIds = [...new Set([
    ...revenue.monedas.map((row) => row.moneda_id),
    ...cost.monedas.map((row) => row.moneda_id),
  ])];
  let sharedMemberships = 0;
  let withoutTrainer = 0;
  let costWithoutRevenue = 0;

  const currencies = currencyIds.map((currencyId) => {
    const revenueCurrency = revenue.monedas.find((row) => row.moneda_id === currencyId);
    const costCurrency = cost.monedas.find((row) => row.moneda_id === currencyId);
    const revenueRows = revenueCurrency?.membresias ?? [];
    const costRows = costCurrency?.costos ?? [];
    const commissionRows = costRows.filter((row) => row.fuente === "COMISION");
    const fixedRows = costRows.filter((row) => row.fuente === "FIJO");

    const membershipTrainers = new Map<string, Set<string>>();
    for (const row of commissionRows) {
      if (!row.membresia_id) continue;
      const trainers = membershipTrainers.get(row.membresia_id) ?? new Set<string>();
      trainers.add(row.entrenador_id);
      membershipTrainers.set(row.membresia_id, trainers);
    }
    const revenueMembershipIds = new Set(revenueRows.map((row) => row.membresia_id));

    const plans = new Map<string, MarginBucket & { planName: string }>();
    const clients = new Map<string, MarginBucket & { clientName: string }>();
    const trainers = new Map<string, TrainerBucket>();
    const shared = emptyAttribution();
    const noTrainer = emptyAttribution();
    const orphanCost = emptyAttribution();
    let commissionMes = 0n;
    let commissionAcumulado = 0n;
    let fixedMes = 0n;
    let fixedAcumulado = 0n;
    let costWithoutPlan = false;
    let costWithoutClient = false;

    for (const row of revenueRows) {
      const earnedMonth = money(row.devengado_mes);
      const earnedToCutoff = money(row.devengado_acumulado);
      const plan = plans.get(row.plan_id) ??
        { ...emptyBucket(), planName: row.plan_nombre };
      plan.planName = row.plan_nombre;
      addRevenue(plan, row, earnedMonth, earnedToCutoff);
      plans.set(row.plan_id, plan);
      const client = clients.get(row.ci) ??
        { ...emptyBucket(), clientName: row.cliente_nombre };
      client.clientName = row.cliente_nombre;
      addRevenue(client, row, earnedMonth, earnedToCutoff);
      clients.set(row.ci, client);

      const linkedTrainers = membershipTrainers.get(row.membresia_id);
      if (!linkedTrainers || linkedTrainers.size === 0) {
        noTrainer.membresias.add(row.membresia_id);
        noTrainer.ingresoMes += earnedMonth;
        noTrainer.ingresoAcumulado += earnedToCutoff;
      } else if (linkedTrainers.size === 1) {
        const trainerId = [...linkedTrainers][0];
        const trainer = trainerBucket(trainers, trainerId, trainerName(commissionRows, trainerId));
        addRevenue(trainer, row, earnedMonth, earnedToCutoff);
        trainers.set(trainerId, trainer);
      } else {
        shared.membresias.add(row.membresia_id);
        shared.ingresoMes += earnedMonth;
        shared.ingresoAcumulado += earnedToCutoff;
        for (const trainerId of linkedTrainers) {
          const trainer = trainerBucket(trainers, trainerId, trainerName(commissionRows, trainerId));
          trainer.compartidas.add(row.membresia_id);
          trainers.set(trainerId, trainer);
        }
      }
    }

    for (const row of commissionRows) {
      const costMonth = money(row.costo_devengado_mes);
      const costToCutoff = money(row.costo_devengado_acumulado);
      commissionMes += costMonth;
      commissionAcumulado += costToCutoff;
      if (row.plan_id) {
        const plan = plans.get(row.plan_id) ??
          { ...emptyBucket(), planName: row.plan_nombre ?? "Plan sin identificar" };
        addCost(plan, costMonth, costToCutoff, row.requiere_revision);
        plans.set(row.plan_id, plan);
      } else {
        costWithoutPlan = true;
      }
      if (row.ci) {
        const client = clients.get(row.ci) ??
          { ...emptyBucket(), clientName: row.cliente_nombre ?? "Socio sin identificar" };
        addCost(client, costMonth, costToCutoff, row.requiere_revision);
        clients.set(row.ci, client);
      } else {
        costWithoutClient = true;
      }
      const trainer = trainerBucket(trainers, row.entrenador_id, row.entrenador_nombre);
      trainer.requiresReview ||= row.requiere_revision;
      const membershipKnown = row.membresia_id != null &&
        revenueMembershipIds.has(row.membresia_id);
      const linkedTrainers = row.membresia_id
        ? membershipTrainers.get(row.membresia_id)
        : undefined;
      if (!membershipKnown) {
        orphanCost.conceptos += 1;
        orphanCost.costoMes += costMonth;
        orphanCost.costoAcumulado += costToCutoff;
        trainer.costoSinIngresoMes += costMonth;
        trainer.costoSinIngresoAcumulado += costToCutoff;
      } else if (linkedTrainers && linkedTrainers.size > 1) {
        shared.costoMes += costMonth;
        shared.costoAcumulado += costToCutoff;
        trainer.costoCompartidoMes += costMonth;
        trainer.costoCompartidoAcumulado += costToCutoff;
      } else {
        trainer.costoMes += costMonth;
        trainer.costoAcumulado += costToCutoff;
      }
      if (row.membresia_id) trainer.membresias.add(row.membresia_id);
      if (row.ci) trainer.clientes.add(row.ci);
      if (row.plan_id) trainer.planes.add(row.plan_id);
      trainers.set(row.entrenador_id, trainer);
    }

    for (const row of fixedRows) {
      const costMonth = money(row.costo_devengado_mes);
      const costToCutoff = money(row.costo_devengado_acumulado);
      fixedMes += costMonth;
      fixedAcumulado += costToCutoff;
      const trainer = trainerBucket(trainers, row.entrenador_id, row.entrenador_nombre);
      trainer.fijoMes += costMonth;
      trainer.fijoAcumulado += costToCutoff;
      trainer.requiresReview ||= row.requiere_revision;
      trainers.set(row.entrenador_id, trainer);
    }

    sharedMemberships += shared.membresias.size;
    withoutTrainer += noTrainer.membresias.size;
    costWithoutRevenue += orphanCost.conceptos;

    const ingresoMes = money(revenueCurrency?.ingreso_devengado_mes ?? "0.00");
    const ingresoAcumulado = money(
      revenueCurrency?.ingreso_devengado_acumulado ?? "0.00",
    );
    const margenMes = ingresoMes - commissionMes;
    const margenAcumulado = ingresoAcumulado - commissionAcumulado;

    return {
      moneda_id: currencyId,
      moneda_codigo: revenueCurrency?.moneda_codigo ??
        costCurrency?.moneda_codigo ?? "—",
      ingreso_devengado_mes: treasuryMinorToMoney(ingresoMes),
      ingreso_devengado_acumulado: treasuryMinorToMoney(ingresoAcumulado),
      costo_directo_mes: treasuryMinorToMoney(commissionMes),
      costo_directo_acumulado: treasuryMinorToMoney(commissionAcumulado),
      margen_directo_mes: treasuryMinorToMoney(margenMes),
      margen_directo_acumulado: treasuryMinorToMoney(margenAcumulado),
      margen_directo_pct_acumulado: percent(margenAcumulado, ingresoAcumulado),
      fijo_no_distribuido_mes: treasuryMinorToMoney(fixedMes),
      fijo_no_distribuido_acumulado: treasuryMinorToMoney(fixedAcumulado),
      margen_menos_fijo_mes: treasuryMinorToMoney(margenMes - fixedMes),
      margen_menos_fijo_acumulado: treasuryMinorToMoney(
        margenAcumulado - fixedAcumulado,
      ),
      planes: [...plans.entries()]
        .map(([planId, bucket]) => ({
          plan_id: planId,
          plan_nombre: bucket.planName,
          membresias: bucket.membresias.size,
          clientes: bucket.clientes.size,
          ...presentBucket(bucket),
        }))
        .sort(byMarginThen((row) => row.plan_nombre)),
      entrenadores: [...trainers.entries()]
        .map(([trainerId, bucket]) => ({
          entrenador_id: trainerId,
          entrenador_nombre: bucket.trainerName,
          membresias_vinculadas: bucket.membresias.size,
          membresias_compartidas: bucket.compartidas.size,
          clientes: bucket.clientes.size,
          planes: bucket.planes.size,
          ...presentBucket(bucket),
          fijo_no_distribuido_mes: treasuryMinorToMoney(bucket.fijoMes),
          fijo_no_distribuido_acumulado: treasuryMinorToMoney(bucket.fijoAcumulado),
          costo_compartido_acumulado: treasuryMinorToMoney(
            bucket.costoCompartidoAcumulado,
          ),
          costo_sin_ingreso_acumulado: treasuryMinorToMoney(
            bucket.costoSinIngresoAcumulado,
          ),
          atribucion_completa: bucket.compartidas.size === 0 &&
            bucket.costoSinIngresoAcumulado === 0n &&
            bucket.costoSinIngresoMes === 0n,
        }))
        .sort(byMarginThen((row) => row.entrenador_nombre)),
      clientes: [...clients.entries()]
        .map(([clientId, bucket]) => ({
          ci: clientId,
          cliente_nombre: bucket.clientName,
          membresias: bucket.membresias.size,
          planes: bucket.planes.size,
          ...presentBucket(bucket),
        }))
        .sort(byMarginThen((row) => row.cliente_nombre)),
      atribucion: {
        membresias_compartidas: shared.membresias.size,
        ingreso_compartido_mes: treasuryMinorToMoney(shared.ingresoMes),
        ingreso_compartido_acumulado: treasuryMinorToMoney(shared.ingresoAcumulado),
        costo_compartido_mes: treasuryMinorToMoney(shared.costoMes),
        costo_compartido_acumulado: treasuryMinorToMoney(shared.costoAcumulado),
        membresias_sin_entrenador: noTrainer.membresias.size,
        ingreso_sin_entrenador_mes: treasuryMinorToMoney(noTrainer.ingresoMes),
        ingreso_sin_entrenador_acumulado: treasuryMinorToMoney(
          noTrainer.ingresoAcumulado,
        ),
        conceptos_costo_sin_ingreso: orphanCost.conceptos,
        costo_sin_ingreso_mes: treasuryMinorToMoney(orphanCost.costoMes),
        costo_sin_ingreso_acumulado: treasuryMinorToMoney(orphanCost.costoAcumulado),
        costo_sin_plan: costWithoutPlan,
        costo_sin_socio: costWithoutClient,
      },
    };
  }).sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo));

  return {
    mes: revenue.mes,
    naturaleza: "MARGEN_GERENCIAL",
    estado_periodo: revenue.estado_periodo,
    fecha_corte: revenue.fecha_corte,
    cobertura: {
      membresias_evaluadas: revenue.cobertura.membresias_evaluadas,
      conceptos_costo_evaluados: cost.cobertura.conceptos_evaluados,
      requieren_revision: revenue.cobertura.requieren_revision +
        cost.cobertura.requieren_revision,
      membresias_compartidas: sharedMemberships,
      membresias_sin_entrenador: withoutTrainer,
      conceptos_costo_sin_ingreso: costWithoutRevenue,
      completa: revenue.cobertura.completa && cost.cobertura.completa &&
        costWithoutRevenue === 0,
    },
    monedas: currencies,
    nota:
      "Resta del servicio ya prestado el costo directo de comisión que ese servicio generó. No incluye gastos generales ni impuestos y no representa la utilidad del gimnasio.",
    limitaciones: [
      "No mezcla ni convierte monedas.",
      "La compensación fija se muestra separada como FIJO_NO_DISTRIBUIDO y solo se resta en el total por moneda; no se reparte entre planes, socios o membresías.",
      "Una membresía servida por más de un entrenador no divide su ingreso: se presenta como atribución compartida hasta que dirección apruebe una regla de reparto.",
      "Los meses históricos son reconstrucciones provisionales hasta incorporarse a un cierre certificado.",
    ],
  };
}

function emptyBucket(): MarginBucket {
  return {
    ingresoMes: 0n,
    ingresoAcumulado: 0n,
    costoMes: 0n,
    costoAcumulado: 0n,
    membresias: new Set<string>(),
    clientes: new Set<string>(),
    planes: new Set<string>(),
    requiresReview: false,
  };
}

function emptyAttribution() {
  return {
    membresias: new Set<string>(),
    conceptos: 0,
    ingresoMes: 0n,
    ingresoAcumulado: 0n,
    costoMes: 0n,
    costoAcumulado: 0n,
  };
}

function trainerBucket(
  trainers: Map<string, TrainerBucket>,
  trainerId: string,
  name: string,
): TrainerBucket {
  const existing = trainers.get(trainerId);
  if (existing) {
    if (name) existing.trainerName = name;
    return existing;
  }
  return {
    ...emptyBucket(),
    trainerName: name || "Entrenador",
    fijoMes: 0n,
    fijoAcumulado: 0n,
    compartidas: new Set<string>(),
    costoCompartidoMes: 0n,
    costoCompartidoAcumulado: 0n,
    costoSinIngresoMes: 0n,
    costoSinIngresoAcumulado: 0n,
  };
}

function trainerName(
  rows: Array<{ entrenador_id: string; entrenador_nombre: string }>,
  trainerId: string,
) {
  return rows.find((row) => row.entrenador_id === trainerId)?.entrenador_nombre ?? "";
}

function addRevenue(
  bucket: MarginBucket,
  row: {
    membresia_id: string;
    ci: string;
    plan_id: string;
    requiere_revision: boolean;
  },
  earnedMonth: bigint,
  earnedToCutoff: bigint,
) {
  bucket.ingresoMes += earnedMonth;
  bucket.ingresoAcumulado += earnedToCutoff;
  bucket.membresias.add(row.membresia_id);
  bucket.clientes.add(row.ci);
  bucket.planes.add(row.plan_id);
  bucket.requiresReview ||= row.requiere_revision;
}

function addCost(
  bucket: MarginBucket,
  costMonth: bigint,
  costToCutoff: bigint,
  requiresReview: boolean,
) {
  bucket.costoMes += costMonth;
  bucket.costoAcumulado += costToCutoff;
  bucket.requiresReview ||= requiresReview;
}

function presentBucket(bucket: MarginBucket) {
  return {
    ingreso_devengado_mes: treasuryMinorToMoney(bucket.ingresoMes),
    ingreso_devengado_acumulado: treasuryMinorToMoney(bucket.ingresoAcumulado),
    costo_directo_mes: treasuryMinorToMoney(bucket.costoMes),
    costo_directo_acumulado: treasuryMinorToMoney(bucket.costoAcumulado),
    margen_directo_mes: treasuryMinorToMoney(bucket.ingresoMes - bucket.costoMes),
    margen_directo_acumulado: treasuryMinorToMoney(
      bucket.ingresoAcumulado - bucket.costoAcumulado,
    ),
    margen_directo_pct_acumulado: percent(
      bucket.ingresoAcumulado - bucket.costoAcumulado,
      bucket.ingresoAcumulado,
    ),
    requiere_revision: bucket.requiresReview,
  };
}

function byMarginThen<Row extends { margen_directo_acumulado: string }>(
  name: (row: Row) => string,
) {
  return (left: Row, right: Row) => {
    const leftMargin = treasuryMoneyToMinor(left.margen_directo_acumulado);
    const rightMargin = treasuryMoneyToMinor(right.margen_directo_acumulado);
    if (rightMargin > leftMargin) return 1;
    if (rightMargin < leftMargin) return -1;
    return name(left).localeCompare(name(right));
  };
}

function percent(margin: bigint, income: bigint): string | null {
  if (income <= 0n) return null;
  const scaled = margin * 1000n;
  const rounded = scaled >= 0n
    ? (scaled + income / 2n) / income
    : -((-scaled + income / 2n) / income);
  const absolute = rounded < 0n ? -rounded : rounded;
  return `${rounded < 0n ? "-" : ""}${absolute / 10n}.${absolute % 10n}`;
}

function money(value: string) {
  try {
    return treasuryMoneyToMinor(value);
  } catch {
    throw new ManagementMarginPolicyError(
      "Un importe de los informes base no contiene un decimal válido.",
    );
  }
}
