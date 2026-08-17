export class OperationalResultsPolicyError extends Error {}

export type OperationalMovementDirection = "ENTRADA" | "SALIDA";

export type OperationalResultScope =
  | "OPERATIVO"
  | "NO_OPERATIVO"
  | "NEUTRO"
  /**
   * M4b — efectivo que entró en esta caja pero cuyo ingreso es de otro: de otra
   * sede o de la cadena (docs/MULTI_SEDE.md §5.3).
   *
   * Es un ámbito propio y no `NO_OPERATIVO`, aunque los dos queden fuera del
   * resultado. Mezclarlos escondería la cifra justo donde hace falta verla: el
   * cierre de la sede tiene que enseñar «lo mío» y «lo que cobré por cuenta
   * ajena» en dos bloques, con su contraparte al lado, porque de ese segundo
   * bloque sale la deuda que alguien va a reclamar.
   */
  | "POR_CUENTA_AJENA"
  | "REVISAR";

export type OperationalResultCategory =
  | "COBROS_PLANES"
  | "CAMBIO_ENTREGADO"
  | "ANULACIONES_COBRO"
  | "PAGOS_ENTRENADORES"
  | "REEMBOLSOS_CLIENTES"
  | "GASTOS_MANUALES"
  | "DEPOSITOS_MANUALES"
  | "RETIROS_MANUALES"
  | "TRANSFERENCIAS_INTERNAS"
  | "COBRADO_CUENTA_AJENA"
  | "SIN_CLASIFICAR";

export type OperationalMovementInput = {
  concept: string;
  direction: OperationalMovementDirection;
  amountMinor: bigint;
  /**
   * `origen_tipo` del movimiento. Opcional para no romper a quien clasificaba
   * solo por concepto, pero cuando dice que el cobro es por cuenta ajena
   * **manda sobre el concepto**: la familia la decidió la política del cobro
   * contra la base, y un concepto nuevo que nadie recuerde mapear caería si no
   * en «sin clasificar», es decir, fuera del resultado pero también fuera del
   * bloque donde se ve la deuda.
   */
  sourceType?: string | null;
};

export type OperationalMovementClassification = {
  category: OperationalResultCategory;
  label: string;
  scope: OperationalResultScope;
  signedMinor: bigint;
  requiresReview: boolean;
};

export type OperationalMovementSummaryInput = OperationalMovementInput & {
  currencyId: string;
};

export type OperationalCategorySummary = OperationalMovementClassification & {
  movementCount: number;
};

export type OperationalCurrencySummary = {
  currencyId: string;
  categories: OperationalCategorySummary[];
  scopeTotals: Record<OperationalResultScope, bigint>;
  operationalNetMinor: bigint;
  ledgerNetMinor: bigint;
  movementCount: number;
  reviewCount: number;
};

type CategoryDefinition = Omit<
  OperationalMovementClassification,
  "signedMinor"
>;

const definitions: Record<OperationalResultCategory, CategoryDefinition> = {
  COBROS_PLANES: {
    category: "COBROS_PLANES",
    label: "Cobros de planes",
    scope: "OPERATIVO",
    requiresReview: false,
  },
  CAMBIO_ENTREGADO: {
    category: "CAMBIO_ENTREGADO",
    label: "Cambio entregado",
    scope: "OPERATIVO",
    requiresReview: false,
  },
  ANULACIONES_COBRO: {
    category: "ANULACIONES_COBRO",
    label: "Anulaciones de cobro",
    scope: "OPERATIVO",
    requiresReview: false,
  },
  PAGOS_ENTRENADORES: {
    category: "PAGOS_ENTRENADORES",
    label: "Pagos a entrenadores",
    scope: "OPERATIVO",
    requiresReview: false,
  },
  REEMBOLSOS_CLIENTES: {
    category: "REEMBOLSOS_CLIENTES",
    label: "Reembolsos a clientes",
    scope: "OPERATIVO",
    requiresReview: false,
  },
  GASTOS_MANUALES: {
    category: "GASTOS_MANUALES",
    label: "Gastos manuales",
    scope: "OPERATIVO",
    requiresReview: true,
  },
  DEPOSITOS_MANUALES: {
    category: "DEPOSITOS_MANUALES",
    label: "Depósitos manuales",
    scope: "REVISAR",
    requiresReview: true,
  },
  RETIROS_MANUALES: {
    category: "RETIROS_MANUALES",
    label: "Retiros de liquidez",
    scope: "NO_OPERATIVO",
    requiresReview: false,
  },
  TRANSFERENCIAS_INTERNAS: {
    category: "TRANSFERENCIAS_INTERNAS",
    label: "Transferencias internas",
    scope: "NEUTRO",
    requiresReview: false,
  },
  COBRADO_CUENTA_AJENA: {
    category: "COBRADO_CUENTA_AJENA",
    label: "Cobrado por cuenta ajena",
    scope: "POR_CUENTA_AJENA",
    requiresReview: false,
  },
  SIN_CLASIFICAR: {
    category: "SIN_CLASIFICAR",
    label: "Sin clasificar",
    scope: "REVISAR",
    requiresReview: true,
  },
};

const categoryByConcept: Record<string, OperationalResultCategory> = {
  PLAN_CLIENTE: "COBROS_PLANES",
  CAMBIO_CLIENTE: "CAMBIO_ENTREGADO",
  REVERSO_CAMBIO_CLIENTE: "CAMBIO_ENTREGADO",
  ANULACION_COBRO: "ANULACIONES_COBRO",
  PAGO_ENTRENADOR: "PAGOS_ENTRENADORES",
  LIQUIDACION_FINAL_ENTRENADOR: "PAGOS_ENTRENADORES",
  REVERSO_PAGO_ENTRENADOR: "PAGOS_ENTRENADORES",
  REEMBOLSO_CLIENTE: "REEMBOLSOS_CLIENTES",
  REVERSO_REEMBOLSO: "REEMBOLSOS_CLIENTES",
  MANUAL_GASTO: "GASTOS_MANUALES",
  MANUAL_DEPOSITO: "DEPOSITOS_MANUALES",
  MANUAL_RETIRO: "RETIROS_MANUALES",
  MANUAL_TRANSFERENCIA: "TRANSFERENCIAS_INTERNAS",
  // M4b: el plus multi-sede es ingreso de la cadena, aunque se cobre en la
  // propia sede del socio (§5.1). El plan de un visitante es ingreso de su
  // sede (M4c). Los dos dejan el efectivo aquí y el ingreso allá.
  COBRO_PLUS_MULTISEDE: "COBRADO_CUENTA_AJENA",
  REVERSO_COBRO_PLUS_MULTISEDE: "COBRADO_CUENTA_AJENA",
  PLAN_CLIENTE_OTRA_SEDE: "COBRADO_CUENTA_AJENA",
  REVERSO_PLAN_CLIENTE_OTRA_SEDE: "COBRADO_CUENTA_AJENA",
};

/** `origen_tipo` que marca la familia del cobro por cuenta ajena (M4b). */
const ORIGEN_COBRO_AJENO = "COBRO_CUENTA_AJENA";

const categoryOrder = Object.keys(definitions) as OperationalResultCategory[];

function normalizeConcept(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function assertDirection(
  value: unknown,
): asserts value is OperationalMovementDirection {
  if (value !== "ENTRADA" && value !== "SALIDA") {
    throw new OperationalResultsPolicyError(
      "La dirección del movimiento debe ser ENTRADA o SALIDA.",
    );
  }
}

function assertAmountMinor(value: unknown): asserts value is bigint {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new OperationalResultsPolicyError(
      "El importe del movimiento debe ser positivo y expresado en unidades menores.",
    );
  }
}

export function classifyOperationalMovement(
  input: OperationalMovementInput,
): OperationalMovementClassification {
  assertDirection(input.direction);
  assertAmountMinor(input.amountMinor);
  const concept = normalizeConcept(input.concept);
  const category =
    normalizeConcept(input.sourceType) === ORIGEN_COBRO_AJENO
      ? "COBRADO_CUENTA_AJENA"
      : categoryByConcept[concept] ?? "SIN_CLASIFICAR";
  const definition = definitions[category];
  return {
    ...definition,
    signedMinor: input.direction === "ENTRADA"
      ? input.amountMinor
      : -input.amountMinor,
  };
}

export function summarizeOperationalMovements(
  rows: readonly OperationalMovementSummaryInput[],
): OperationalCurrencySummary[] {
  const currencies = new Map<
    string,
    {
      categories: Map<OperationalResultCategory, OperationalCategorySummary>;
      scopeTotals: Record<OperationalResultScope, bigint>;
      ledgerNetMinor: bigint;
      movementCount: number;
      reviewCount: number;
    }
  >();

  for (const row of rows) {
    const currencyId = String(row.currencyId ?? "").trim();
    if (!currencyId) {
      throw new OperationalResultsPolicyError(
        "Cada movimiento requiere una moneda para evitar agregaciones ambiguas.",
      );
    }
    const classification = classifyOperationalMovement(row);
    let currency = currencies.get(currencyId);
    if (!currency) {
      currency = {
        categories: new Map(),
        scopeTotals: {
          OPERATIVO: 0n,
          NO_OPERATIVO: 0n,
          NEUTRO: 0n,
          POR_CUENTA_AJENA: 0n,
          REVISAR: 0n,
        },
        ledgerNetMinor: 0n,
        movementCount: 0,
        reviewCount: 0,
      };
      currencies.set(currencyId, currency);
    }

    const current = currency.categories.get(classification.category);
    currency.categories.set(classification.category, current
      ? {
        ...current,
        signedMinor: current.signedMinor + classification.signedMinor,
        movementCount: current.movementCount + 1,
      }
      : { ...classification, movementCount: 1 });
    currency.scopeTotals[classification.scope] += classification.signedMinor;
    currency.ledgerNetMinor += classification.signedMinor;
    currency.movementCount += 1;
    if (classification.requiresReview) currency.reviewCount += 1;
  }

  return [...currencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currencyId, value]) => ({
      currencyId,
      categories: [...value.categories.values()].sort(
        (left, right) =>
          categoryOrder.indexOf(left.category) -
          categoryOrder.indexOf(right.category),
      ),
      scopeTotals: value.scopeTotals,
      operationalNetMinor: value.scopeTotals.OPERATIVO,
      ledgerNetMinor: value.ledgerNetMinor,
      movementCount: value.movementCount,
      reviewCount: value.reviewCount,
    }));
}
