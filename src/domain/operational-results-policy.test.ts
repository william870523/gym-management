import { describe, expect, test } from "bun:test";
import {
  classifyOperationalMovement,
  summarizeOperationalMovements,
  type OperationalMovementDirection,
} from "./operational-results-policy";

describe("operational results policy", () => {
  test.each([
    ["PLAN_CLIENTE", "ENTRADA", "COBROS_PLANES", "OPERATIVO", false],
    ["ANULACION_COBRO", "SALIDA", "ANULACIONES_COBRO", "OPERATIVO", false],
    ["CAMBIO_CLIENTE", "SALIDA", "CAMBIO_ENTREGADO", "OPERATIVO", false],
    ["REVERSO_CAMBIO_CLIENTE", "ENTRADA", "CAMBIO_ENTREGADO", "OPERATIVO", false],
    ["REEMBOLSO_CLIENTE", "SALIDA", "REEMBOLSOS_CLIENTES", "OPERATIVO", false],
    ["REVERSO_REEMBOLSO", "ENTRADA", "REEMBOLSOS_CLIENTES", "OPERATIVO", false],
    ["PAGO_ENTRENADOR", "SALIDA", "PAGOS_ENTRENADORES", "OPERATIVO", false],
    ["LIQUIDACION_FINAL_ENTRENADOR", "SALIDA", "PAGOS_ENTRENADORES", "OPERATIVO", false],
    ["REVERSO_PAGO_ENTRENADOR", "ENTRADA", "PAGOS_ENTRENADORES", "OPERATIVO", false],
    ["MANUAL_GASTO", "SALIDA", "GASTOS_MANUALES", "OPERATIVO", true],
    ["MANUAL_DEPOSITO", "ENTRADA", "DEPOSITOS_MANUALES", "REVISAR", true],
    ["MANUAL_RETIRO", "SALIDA", "RETIROS_MANUALES", "NO_OPERATIVO", false],
    ["MANUAL_TRANSFERENCIA", "SALIDA", "TRANSFERENCIAS_INTERNAS", "NEUTRO", false],
    ["CONCEPTO_NUEVO", "ENTRADA", "SIN_CLASIFICAR", "REVISAR", true],
  ] as const)(
    "clasifica %s en %s",
    (concept, direction, category, scope, requiresReview) => {
      const result = classifyOperationalMovement({
        concept,
        direction,
        amountMinor: 123n,
      });
      expect(result).toMatchObject({ category, scope, requiresReview });
      expect(result.signedMinor).toBe(direction === "ENTRADA" ? 123n : -123n);
    },
  );

  test("normaliza el concepto sin alterar el importe", () => {
    expect(classifyOperationalMovement({
      concept: "  plan_cliente  ",
      direction: "ENTRADA",
      amountMinor: 10_050n,
    })).toEqual({
      category: "COBROS_PLANES",
      label: "Cobros de planes",
      scope: "OPERATIVO",
      signedMinor: 10_050n,
      requiresReview: false,
    });
  });

  test("agrupa por categoría y mantiene cada moneda separada", () => {
    const summaries = summarizeOperationalMovements([
      movement("CUP", "PLAN_CLIENTE", "ENTRADA", 10_000n),
      movement("CUP", "CAMBIO_CLIENTE", "SALIDA", 1_000n),
      movement("CUP", "MANUAL_TRANSFERENCIA", "SALIDA", 2_500n),
      movement("CUP", "MANUAL_TRANSFERENCIA", "ENTRADA", 2_500n),
      movement("CUP", "MANUAL_DEPOSITO", "ENTRADA", 500n),
      movement("EUR", "PLAN_CLIENTE", "ENTRADA", 2_000n),
      movement("EUR", "PAGO_ENTRENADOR", "SALIDA", 800n),
    ]);

    expect(summaries).toHaveLength(2);
    const cup = summaries.find((row) => row.currencyId === "CUP")!;
    const eur = summaries.find((row) => row.currencyId === "EUR")!;
    expect(cup.operationalNetMinor).toBe(9_000n);
    expect(cup.scopeTotals.NEUTRO).toBe(0n);
    expect(cup.scopeTotals.REVISAR).toBe(500n);
    expect(cup.ledgerNetMinor).toBe(9_500n);
    expect(cup.reviewCount).toBe(1);
    expect(cup.categories.find(
      (row) => row.category === "TRANSFERENCIAS_INTERNAS",
    )).toMatchObject({ signedMinor: 0n, movementCount: 2 });
    expect(eur.operationalNetMinor).toBe(1_200n);
    expect(eur.ledgerNetMinor).toBe(1_200n);
  });

  test("rechaza dirección, importe o moneda ambiguos", () => {
    expect(() => classifyOperationalMovement({
      concept: "PLAN_CLIENTE",
      direction: "OTRA" as OperationalMovementDirection,
      amountMinor: 100n,
    })).toThrow("ENTRADA o SALIDA");
    expect(() => classifyOperationalMovement({
      concept: "PLAN_CLIENTE",
      direction: "ENTRADA",
      amountMinor: 0n,
    })).toThrow("positivo");
    expect(() => summarizeOperationalMovements([
      movement(" ", "PLAN_CLIENTE", "ENTRADA", 100n),
    ])).toThrow("requiere una moneda");
  });
});

function movement(
  currencyId: string,
  concept: string,
  direction: OperationalMovementDirection,
  amountMinor: bigint,
) {
  return { currencyId, concept, direction, amountMinor };
}
