import { createHash } from "crypto";
import { describe, expect, test } from "bun:test";
import type {
  OperationalResultsPeriod,
  OperationalResultsReadData,
  OperationalResultsReader,
  OperationalMonthlyCloseReadRow,
} from "./operational-results.reader";
import {
  OperationalResultsService,
  OperationalResultsServiceError,
} from "./operational-results.service";

class FakeReader implements OperationalResultsReader {
  constructor(
    private readonly data: OperationalResultsReadData,
    private readonly closes: OperationalMonthlyCloseReadRow[] = [],
  ) {}

  async currentBusinessMonth() {
    return "2026-06";
  }

  async read(_gymId: string, _period: OperationalResultsPeriod) {
    return this.data;
  }

  async readMonthlyCloses() {
    return this.closes;
  }
}

const day = new Date("2026-06-10T00:00:00.000Z");
const movement = (
  id: string,
  currencyId: string,
  concept: string,
  direction: "ENTRADA" | "SALIDA",
  amount: string,
  accountId: string | null = "cash",
) => ({
  movementId: id,
  currencyId,
  concept,
  direction,
  amount,
  accountId,
  businessDate: day,
  requiresReview: false,
});

describe("remote OperationalResultsService parity", () => {
  test("separa monedas y excluye transferencias del flujo operativo", async () => {
    const service = new OperationalResultsService(new FakeReader({
      movements: [
        movement("1", "cup", "PLAN_CLIENTE", "ENTRADA", "100.00"),
        movement("2", "cup", "CAMBIO_CLIENTE", "SALIDA", "5.00"),
        movement("3", "cup", "ANULACION_COBRO", "SALIDA", "20.00"),
        movement("4", "cup", "MANUAL_GASTO", "SALIDA", "10.00"),
        movement("5", "cup", "PAGO_ENTRENADOR", "SALIDA", "15.00"),
        movement("6", "cup", "REVERSO_PAGO_ENTRENADOR", "ENTRADA", "5.00"),
        movement("7", "cup", "MANUAL_TRANSFERENCIA", "SALIDA", "30.00"),
        movement("8", "cup", "MANUAL_TRANSFERENCIA", "ENTRADA", "30.00", "bank"),
        movement("9", "eur", "PLAN_CLIENTE", "ENTRADA", "20.00", "eur-bank"),
      ],
      accounts: [
        { accountId: "cash", name: "Caja CUP", currencyId: "cup" },
        { accountId: "bank", name: "Banco CUP", currencyId: "cup" },
        { accountId: "eur-bank", name: "Banco EUR", currencyId: "eur" },
      ],
      currencies: [
        { currencyId: "cup", code: "CUP" },
        { currencyId: "eur", code: "EUR" },
      ],
      dailyCloses: [],
      monthlyClose: null,
    }));

    const result = await service.get({ gymId: "gym", month: "2026-06" });
    const cup = result.monedas.find((row: any) => row.moneda_codigo === "CUP")!;
    const eur = result.monedas.find((row: any) => row.moneda_codigo === "EUR")!;

    expect(cup.caja.cobros_brutos).toBe("100.00");
    expect(cup.caja.cambio_entregado_neto).toBe("5.00");
    expect(cup.caja.anulaciones_netas).toBe("20.00");
    expect(cup.caja.pagos_entrenadores_netos).toBe("10.00");
    expect(cup.caja.flujo_operativo).toBe("55.00");
    expect(cup.caja.neto_libro).toBe("55.00");
    expect(eur.caja.flujo_operativo).toBe("20.00");
    expect(cup.obligaciones.disponible).toBeFalse();
    expect(result.certificado).toBeFalse();
  });

  test("expone movimientos pendientes de clasificación sin llamarlos ingreso", async () => {
    const service = new OperationalResultsService(new FakeReader({
      movements: [
        movement("1", "cup", "PLAN_CLIENTE", "ENTRADA", "100.00"),
        movement("2", "cup", "MANUAL_DEPOSITO", "ENTRADA", "7.00"),
      ],
      accounts: [{ accountId: "cash", name: "Caja", currencyId: "cup" }],
      currencies: [{ currencyId: "cup", code: "CUP" }],
      dailyCloses: [],
      monthlyClose: null,
    }));

    const result = await service.get({ gymId: "gym" });
    const cup = result.monedas[0]!;
    expect(result.estado_periodo).toBe("REQUIERE_REVISION");
    expect(cup.caja.flujo_operativo).toBe("100.00");
    expect(cup.caja.flujo_pendiente_clasificacion).toBe("7.00");
    expect(cup.caja.neto_libro).toBe("107.00");
    expect(cup.calidad.clasificacion_pendiente).toBe(1);
  });

  test("rechaza un mes contable ambiguo", async () => {
    const service = new OperationalResultsService(new FakeReader({
      movements: [],
      accounts: [],
      currencies: [],
      dailyCloses: [],
      monthlyClose: null,
    }));
    await expect(service.get({ gymId: "gym", month: "06/2026" }))
      .rejects.toBeInstanceOf(OperationalResultsServiceError);
  });

  test("compone reserva inmediata, fondo futuro y acciones por moneda", async () => {
    const service = new OperationalResultsService(new FakeReader({
      movements: [
        movement("1", "cup", "PLAN_CLIENTE", "ENTRADA", "100.00"),
      ],
      accounts: [{ accountId: "cash", name: "Caja", currencyId: "cup" }],
      currencies: [{ currencyId: "cup", code: "CUP" }],
      dailyCloses: [],
      monthlyClose: null,
      businessDate: new Date("2026-07-17T00:00:00.000Z"),
      trainerObligations: [
        {
          referenceId: "earned",
          source: "COMISION",
          trainerId: "trainer-1",
          trainerName: "Entrenadora Demo",
          currencyId: "cup",
          amount: "30.00",
          earningMethod: "PERIODOS_IGUALES",
          periodStart: new Date("2026-06-01T00:00:00.000Z"),
          periodEnd: new Date("2026-07-01T00:00:00.000Z"),
          scheduledDate: new Date("2026-06-30T00:00:00.000Z"),
          state: "PARCIAL",
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-15T10:00:00.000Z"),
          applications: [{
            amount: "10.00",
            state: "APLICADA",
            createdAt: new Date("2026-06-20T10:00:00.000Z"),
            updatedAt: new Date("2026-06-20T10:00:00.000Z"),
          }],
        },
        {
          referenceId: "future",
          source: "COMISION",
          trainerId: "trainer-1",
          trainerName: "Entrenadora Demo",
          currencyId: "cup",
          amount: "60.00",
          earningMethod: "PERIODOS_IGUALES",
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
          periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          scheduledDate: new Date("2026-08-01T00:00:00.000Z"),
          state: "PENDIENTE",
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-01T10:00:00.000Z"),
          applications: [],
        },
      ],
      refundRequests: [{
        adjustmentId: "refund-1",
        clientId: "CI-1",
        clientName: "Cliente Demo",
        currencyId: "cup",
        amount: "5.00",
        requestedAt: new Date("2026-06-25T12:00:00.000Z"),
        events: [],
      }],
    }));

    const result = await service.get({ gymId: "gym", month: "2026-06" });
    const obligations = result.monedas[0]!.obligaciones;
    expect(obligations.disponible).toBeTrue();
    expect(obligations.fecha_corte).toBe("2026-06-30");
    expect(obligations.entrenador_ganado_pendiente).toBe("20.00");
    expect(obligations.entrenador_pagadero_ahora).toBe("20.00");
    expect(obligations.entrenador_futuro).toBe("60.00");
    expect(obligations.reembolsos_pendientes).toBe("5.00");
    expect(obligations.reserva_inmediata).toBe("25.00");
    expect(obligations.compromiso_total).toBe("85.00");
    expect(obligations.entrenadores[0]!.entrenador_nombre)
      .toBe("Entrenadora Demo");
    expect(obligations.reembolsos[0]!.cliente_nombre).toBe("Cliente Demo");
  });

  test("devuelve el resultado congelado cuando el snapshot R3 es íntegro", async () => {
    const frozen = {
      mes: "2026-06",
      estado_periodo: "CERTIFICADO",
      naturaleza: "RESULTADO_OPERATIVO_DE_CAJA",
      certificado: true,
      cierre_tesoreria: null,
      nota_certificacion: "Firmado",
      monedas: [{ moneda_id: "cup", moneda_codigo: "CUP", marcador: "congelado" }],
      limitaciones: [],
    };
    const snapshotJson = JSON.stringify({
      version: 2,
      gym_id: "gym",
      timezone: "America/Havana",
      mes: "2026-06",
      generado_at_utc: "2026-07-01T14:00:00.000Z",
      firmado_por: { nombre: "Administración", rol: "admin" },
      motivo: "Cierre revisado y aprobado para dirección.",
      resultado_operativo: frozen,
    });
    const service = new OperationalResultsService(new FakeReader({
      movements: [movement("live", "cup", "PLAN_CLIENTE", "ENTRADA", "999.00")],
      accounts: [],
      currencies: [],
      dailyCloses: [],
      monthlyClose: {
        monthlyCloseId: "close-r3",
        month: "2026-06",
        state: "CERRADO",
        sha256: createHash("sha256").update(snapshotJson).digest("hex"),
        snapshotJson,
        closedAt: new Date("2026-07-01T14:00:00.000Z"),
        reopenedAt: null,
      },
    }));

    const result = await service.get({ gymId: "gym", month: "2026-06" });
    expect(result.certificado).toBeTrue();
    expect(result.estado_periodo).toBe("CERTIFICADO");
    expect(result.monedas[0]!.marcador).toBe("congelado");
    expect(result.cierre_tesoreria.integridad_verificada).toBeTrue();
    expect(result.cierre_tesoreria.cierre_mensual_id).toBe("close-r3");
  });

  test("compara el año usando solo el último ciclo R3 íntegro", async () => {
    const annualResult = {
      mes: "2026-01",
      naturaleza: "RESULTADO_OPERATIVO_DE_CAJA",
      monedas: [{
        moneda_id: "cup",
        moneda_codigo: "CUP",
        caja: {
          cobros_brutos: "100.00",
          salidas_libro: "30.00",
          flujo_operativo: "70.00",
          pagos_entrenadores_netos: "10.00",
          reembolsos_netos: "2.00",
          otros_egresos_operativos: "3.00",
        },
        obligaciones: {
          reserva_inmediata: "20.00",
          entrenador_pagadero_ahora: "10.00",
          entrenador_futuro: "5.00",
          reembolsos_pendientes: "2.00",
          compromiso_total: "27.00",
        },
      }],
    };
    const snapshot = JSON.stringify({
      version: 2,
      gym_id: "gym",
      mes: "2026-01",
      resultado_operativo: annualResult,
    });
    const legacy = JSON.stringify({ version: 1, gym_id: "gym", mes: "2026-02" });
    const service = new OperationalResultsService(new FakeReader({
      movements: [], accounts: [], currencies: [], dailyCloses: [],
      monthlyClose: null,
    }, [
      {
        monthlyCloseId: "jan-r3",
        month: "2026-01",
        state: "CERRADO",
        sha256: createHash("sha256").update(snapshot).digest("hex"),
        snapshotJson: snapshot,
        closedAt: new Date("2026-02-01T12:00:00.000Z"),
        reopenedAt: null,
      },
      {
        monthlyCloseId: "feb-v1",
        month: "2026-02",
        state: "CERRADO",
        sha256: createHash("sha256").update(legacy).digest("hex"),
        snapshotJson: legacy,
        closedAt: new Date("2026-03-01T12:00:00.000Z"),
        reopenedAt: null,
      },
      {
        monthlyCloseId: "mar-open",
        month: "2026-03",
        state: "REABIERTO",
        sha256: "hash",
        snapshotJson: "{}",
        closedAt: new Date("2026-04-02T12:00:00.000Z"),
        reopenedAt: new Date("2026-04-03T12:00:00.000Z"),
      },
    ]));

    const result = await service.getAnnual({ gymId: "gym", year: "2026" });
    expect(result.cobertura.meses_exigibles).toBe(5);
    expect(result.cobertura.meses_certificados).toBe(1);
    expect(result.meses[0].estado).toBe("CERTIFICADO");
    expect(result.meses[1].estado).toBe("SNAPSHOT_ANTERIOR");
    expect(result.meses[2].estado).toBe("REABIERTO");
    expect(result.monedas[0].totales_flujo.flujo_operativo).toBe("70.00");
  });
});
