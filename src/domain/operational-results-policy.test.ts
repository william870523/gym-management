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

  // M4b — «efectivo aquí, ingreso allá». El ámbito nuevo existe para que el
  // dinero cobrado por cuenta de otro esté en el libro y fuera del resultado,
  // y a la vez se vea en su propia línea: de ahí sale la deuda que alguien va
  // a reclamar (docs/MULTI_SEDE.md §5.3 y §7.10).
  test("el cobro por cuenta ajena queda fuera del flujo operativo y dentro del libro", () => {
    const [cup] = summarizeOperationalMovements([
      movement("cup", "PLAN_CLIENTE", "ENTRADA", 10_000n),
      movement("cup", "COBRO_PLUS_MULTISEDE", "ENTRADA", 15_000n, "COBRO_CUENTA_AJENA"),
    ]);
    expect(cup.operationalNetMinor).toBe(10_000n);
    expect(cup.scopeTotals.POR_CUENTA_AJENA).toBe(15_000n);
    expect(cup.ledgerNetMinor).toBe(25_000n);
    // No es algo «a revisar»: está perfectamente clasificado.
    expect(cup.reviewCount).toBe(0);
  });

  test("el plus es de la cadena aunque el concepto llegue sin origen", () => {
    // Los conceptos conocidos se mapean solos, para la historia ya emitida.
    const clasificacion = classifyOperationalMovement({
      concept: "COBRO_PLUS_MULTISEDE",
      direction: "ENTRADA",
      amountMinor: 15_000n,
    });
    expect(clasificacion.category).toBe("COBRADO_CUENTA_AJENA");
    expect(clasificacion.scope).toBe("POR_CUENTA_AJENA");
  });

  test("el origen manda sobre el concepto", () => {
    // Un concepto nuevo que nadie mapeó caería en «sin clasificar»: fuera del
    // resultado —bien— pero también fuera del bloque de la deuda —mal—.
    expect(classifyOperationalMovement({
      concept: "CONCEPTO_FUTURO",
      direction: "ENTRADA",
      amountMinor: 4_000n,
      sourceType: "COBRO_CUENTA_AJENA",
    }).category).toBe("COBRADO_CUENTA_AJENA");
    expect(classifyOperationalMovement({
      concept: "CONCEPTO_FUTURO",
      direction: "ENTRADA",
      amountMinor: 4_000n,
    }).category).toBe("SIN_CLASIFICAR");
  });

  test("devolver un cobro ajeno deshace la línea, no la mezcla con otra", () => {
    const [cup] = summarizeOperationalMovements([
      movement("cup", "COBRO_PLUS_MULTISEDE", "ENTRADA", 15_000n, "COBRO_CUENTA_AJENA"),
      movement("cup", "REVERSO_COBRO_PLUS_MULTISEDE", "SALIDA", 15_000n, "COBRO_CUENTA_AJENA"),
    ]);
    expect(cup.scopeTotals.POR_CUENTA_AJENA).toBe(0n);
    expect(cup.operationalNetMinor).toBe(0n);
    expect(cup.ledgerNetMinor).toBe(0n);
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
  sourceType: string | null = null,
) {
  return { currencyId, concept, direction, amountMinor, sourceType };
}
