import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TreasuryLedgerService } from "./treasury-ledger.service";
import { prisma } from "../../infrastructure/db/prismaClient";

/**
 * Línea «recargos condonados» del cierre diario (docs/RECARGO_MORA.md §6-bis).
 *
 * Paridad con la prueba SQLite de `gym-local-api`, más el caso multi-tenant:
 * una condonación de otro gimnasio no puede aparecer en este cierre.
 */
/** Falla con un mensaje claro en vez de dejar `undefined` suelto. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`No se encontró ${what}.`);
  return value;
}

describe("TreasuryLedgerService (Remote) · recargos condonados", () => {
  const service = new TreasuryLedgerService();
  const PREFIX = "twlf-";
  const gymId = "local-gym-001";
  const otherGymId = `${PREFIX}gym-b`;
  const BUSINESS_DATE = "2019-03-05";
  const OTHER_DATE = "2019-03-06";
  const businessDate = new Date(`${BUSINESS_DATE}T00:00:00.000Z`);
  const otherDate = new Date(`${OTHER_DATE}T00:00:00.000Z`);
  const CI = "TWLF00000001";
  const CI_B = "TWLF00000002";
  const OPERATOR_ID = `${PREFIX}user-1`;
  const UNKNOWN_OPERATOR_ID = `${PREFIX}user-borrado`;

  let cup = "";
  let usd = "";
  let planId = "";
  let nationalityId = "";

  const paymentIds: string[] = [];
  const movementIds: string[] = [];

  /** Cobro + su movimiento de caja, tal como los deja un pago real. */
  async function seedPayment(input: {
    id: string;
    currencyId: string;
    date: Date;
    total: string;
    gym?: string;
    ci?: string;
    waived?: { importe: string; motivo: string; por: string | null };
    reversed?: boolean;
  }) {
    await prisma.pagoCliente.create({
      data: {
        pago_cliente_id: input.id,
        ci: input.ci ?? CI,
        fecha: input.date,
        monto_total: Number(input.total),
        id_planes_pago: planId,
        moneda_id: input.currencyId,
        recargo_mora_condonado_importe: input.waived?.importe ?? null,
        recargo_mora_condonado_motivo: input.waived?.motivo ?? null,
        recargo_mora_condonado_por: input.waived?.por ?? null,
        is_deleted: Boolean(input.reversed),
        gym_id: input.gym ?? gymId,
      },
    });
    paymentIds.push(input.id);

    const movementId = `${input.id}-mov`;
    await prisma.tesoreriaMovimiento.create({
      data: {
        movimiento_id: movementId,
        clave_origen: `PAGO:${input.id}:TEST`,
        origen_tipo: "PAGO_CLIENTE",
        origen_id: input.id,
        direccion: "ENTRADA",
        concepto: "PLAN_CLIENTE",
        moneda_id: input.currencyId,
        monto: input.total,
        ocurrido_at: input.date,
        fecha_negocio: input.date,
        gym_id: input.gym ?? gymId,
      },
    });
    movementIds.push(movementId);
  }

  beforeAll(async () => {
    const currencies = await prisma.moneda.findMany({
      where: { codigo: { in: ["CUP", "USD"] }, is_deleted: false },
    });
    cup = currencies.find((row) => row.codigo === "CUP")?.moneda_id ?? "";
    usd = currencies.find((row) => row.codigo === "USD")?.moneda_id ?? "";
    if (!cup || !usd) throw new Error("Faltan las monedas CUP/USD de prueba.");

    const plan = await prisma.planesPago.findFirst({ where: { gym_id: gymId } });
    if (!plan) throw new Error("Falta un plan de pago para la prueba.");
    planId = plan.id_planes_pago;

    const nationality = await prisma.nacionalidad.findFirst({
      where: { is_deleted: false },
    });
    if (!nationality) throw new Error("Falta una nacionalidad para la prueba.");
    nationalityId = nationality.nacionalidad_id;

    await prisma.gym.create({
      data: {
        gym_id: otherGymId,
        codigo: `${PREFIX}COD-B`,
        nombre: "Gimnasio B de prueba",
        timezone: "Etc/UTC",
      },
    });
    for (const [ci, gym] of [[CI, gymId], [CI_B, otherGymId]] as const) {
      await prisma.cliente.create({
        data: {
          ci,
          nombres: "Socia",
          apellidos: "De Prueba",
          sexo: "F",
          estatura_cliente: 1.7,
          nacionalidad_id: nationalityId,
          fecha_inicio: businessDate,
          fecha_fin: businessDate,
          activo: true,
          gym_id: gym,
        },
      });
    }
    await prisma.user.create({
      data: {
        user_id: OPERATOR_ID,
        user_nombre: "Ana Recepción",
        user_email: `${OPERATOR_ID}@test.local`,
        password: "x",
        gym_id: gymId,
      },
    });

    // Dos condonaciones en CUP (3.00 + 1.25) y una en USD (5.50).
    await seedPayment({
      id: `${PREFIX}pago-cup-1`,
      currencyId: cup,
      date: businessDate,
      total: "20.00",
      waived: {
        importe: "3.00",
        motivo: "Socio hospitalizado, autorizado",
        por: OPERATOR_ID,
      },
    });
    await seedPayment({
      id: `${PREFIX}pago-cup-2`,
      currencyId: cup,
      date: businessDate,
      total: "10.00",
      waived: {
        importe: "1.25",
        motivo: "Corte de luz en el gimnasio",
        por: UNKNOWN_OPERATOR_ID,
      },
    });
    await seedPayment({
      id: `${PREFIX}pago-usd-1`,
      currencyId: usd,
      date: businessDate,
      total: "40.00",
      waived: { importe: "5.50", motivo: "Error de la recepción", por: OPERATOR_ID },
    });
    // Cobro normal del mismo día: no debe aparecer en la línea.
    await seedPayment({
      id: `${PREFIX}pago-sin-condonar`,
      currencyId: cup,
      date: businessDate,
      total: "15.00",
    });
    // Cobro revertido (is_deleted): la condonación se deshizo con él.
    await seedPayment({
      id: `${PREFIX}pago-revertido`,
      currencyId: cup,
      date: businessDate,
      total: "12.00",
      waived: { importe: "9.99", motivo: "Condonación anulada", por: OPERATOR_ID },
      reversed: true,
    });
    // Condonación de OTRO día: no puede colarse en este cierre.
    await seedPayment({
      id: `${PREFIX}pago-otro-dia`,
      currencyId: cup,
      date: otherDate,
      total: "18.00",
      waived: { importe: "7.00", motivo: "Condonación de otro día", por: OPERATOR_ID },
    });
    // Condonación de OTRO GIMNASIO, mismo día: aislamiento multi-tenant.
    await seedPayment({
      id: `${PREFIX}pago-gym-b`,
      currencyId: cup,
      date: businessDate,
      total: "30.00",
      gym: otherGymId,
      ci: CI_B,
      waived: { importe: "8.00", motivo: "Condonación del gimnasio B", por: OPERATOR_ID },
    });
  });

  afterAll(async () => {
    await prisma.tesoreriaMovimiento.deleteMany({
      where: { movimiento_id: { in: movementIds } },
    });
    await prisma.pagoCliente.deleteMany({
      where: { pago_cliente_id: { in: paymentIds } },
    });
    await prisma.user.deleteMany({ where: { user_id: OPERATOR_ID } });
    await prisma.cliente.deleteMany({ where: { ci: { in: [CI, CI_B] } } });
    await prisma.gym.deleteMany({ where: { gym_id: otherGymId } });
    await prisma.syncLog.deleteMany({
      where: { entidad_id: { in: [...paymentIds, ...movementIds, CI, CI_B, OPERATOR_ID] } },
    });
  });

  test("agrupa lo condonado por moneda, sin mezclarlas", async () => {
    const dashboard = await service.dashboard(gymId, BUSINESS_DATE);
    const waived = dashboard.recargos_condonados;

    expect(waived.condonaciones).toBe(3);
    const byCurrency = new Map(
      waived.por_moneda.map((row: any) => [row.moneda_codigo, row]),
    );
    expect(byCurrency.get("CUP")?.importe).toBe("4.25");
    expect(byCurrency.get("CUP")?.condonaciones).toBe(2);
    expect(byCurrency.get("USD")?.importe).toBe("5.50");
    expect(byCurrency.get("USD")?.condonaciones).toBe(1);
    // Nunca un total único: una fila por moneda.
    expect(waived.por_moneda).toHaveLength(2);
  });

  test("el detalle dice socio, importe, motivo y quién autorizó", async () => {
    const dashboard = await service.dashboard(gymId, BUSINESS_DATE);
    const row = must(
      dashboard.recargos_condonados.detalle.find(
        (item: any) => item.pago_cliente_id === `${PREFIX}pago-cup-1`,
      ),
      "la condonación en CUP del cobro sembrado",
    );

    expect(row.socio).toBe("Socia De Prueba");
    expect(row.ci).toBe(CI);
    expect(row.importe).toBe("3.00");
    expect(row.moneda_codigo).toBe("CUP");
    expect(row.motivo).toBe("Socio hospitalizado, autorizado");
    expect(row.condonado_por).toBe("Ana Recepción");
    expect(row.condonado_por_user_id).toBe(OPERATOR_ID);
  });

  test("un autor ya inexistente no tumba el cierre: cae al user_id", async () => {
    const dashboard = await service.dashboard(gymId, BUSINESS_DATE);
    const row = must(
      dashboard.recargos_condonados.detalle.find(
        (item: any) => item.pago_cliente_id === `${PREFIX}pago-cup-2`,
      ),
      "la condonación con autor inexistente",
    );

    expect(row.condonado_por).toBe(UNKNOWN_OPERATOR_ID);
  });

  test("excluye cobros sin condonar, revertidos y de otro día", async () => {
    const dashboard = await service.dashboard(gymId, BUSINESS_DATE);
    const ids = dashboard.recargos_condonados.detalle.map(
      (item: any) => item.pago_cliente_id,
    );

    expect(ids).not.toContain(`${PREFIX}pago-sin-condonar`);
    expect(ids).not.toContain(`${PREFIX}pago-revertido`);
    expect(ids).not.toContain(`${PREFIX}pago-otro-dia`);
  });

  test("no filtra la condonación de otro gimnasio", async () => {
    const dashboard = await service.dashboard(gymId, BUSINESS_DATE);
    const ids = dashboard.recargos_condonados.detalle.map(
      (item: any) => item.pago_cliente_id,
    );
    expect(ids).not.toContain(`${PREFIX}pago-gym-b`);

    // Y el gimnasio B ve la suya, y solo la suya.
    const otherDashboard = await service.dashboard(otherGymId, BUSINESS_DATE);
    expect(otherDashboard.recargos_condonados.condonaciones).toBe(1);
    expect(otherDashboard.recargos_condonados.detalle[0].pago_cliente_id).toBe(
      `${PREFIX}pago-gym-b`,
    );
    expect(otherDashboard.recargos_condonados.por_moneda[0].importe).toBe("8.00");
  });

  test("lo condonado no altera el arqueo ni el resumen de caja", async () => {
    const dashboard = await service.dashboard(gymId, BUSINESS_DATE);
    const cupSummary = must(
      dashboard.resumen_monedas.find((row: any) => row.moneda_id === cup),
      "el resumen en CUP del día",
    );
    const usdSummary = must(
      dashboard.resumen_monedas.find((row: any) => row.moneda_id === usd),
      "el resumen en USD del día",
    );

    // Entradas = solo lo realmente cobrado (20 + 10 + 15 + 12), sin los 4.25
    // condonados, que no son movimiento de caja.
    expect(cupSummary.entradas).toBe("57.00");
    expect(cupSummary.salidas).toBe("0.00");
    expect(usdSummary.entradas).toBe("40.00");
  });

  test("un día sin condonaciones devuelve la línea vacía", async () => {
    const empty = await service.dashboard(gymId, "2019-03-07");

    expect(empty.recargos_condonados.condonaciones).toBe(0);
    expect(empty.recargos_condonados.por_moneda).toHaveLength(0);
    expect(empty.recargos_condonados.detalle).toHaveLength(0);
  });
});
