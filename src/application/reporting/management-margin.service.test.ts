import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { prepareManagementMarginForCertification } from
  "../../domain/management-margin-certification-policy";
import type {
  ManagementMarginMonthlyCloseReadRow,
  ManagementMarginMonthlyCloseReader,
} from "./management-margin.reader";
import type { MembershipRevenueReader } from "./membership-revenue.reader";
import type { TrainerServiceCostReader } from "./trainer-service-cost.reader";
import {
  ManagementMarginService,
  ManagementMarginServiceError,
} from "./management-margin.service";

class FakeRevenueReader implements MembershipRevenueReader {
  gymIds: string[] = [];

  async currentBusinessDate(gymId: string) {
    this.gymIds.push(gymId);
    return new Date("2026-07-18T00:00:00.000Z");
  }

  async readMemberships(gymId: string) {
    this.gymIds.push(gymId);
    return [];
  }
}

class FakeCostReader implements TrainerServiceCostReader {
  gymIds: string[] = [];

  async currentBusinessDate(gymId: string) {
    this.gymIds.push(gymId);
    return new Date("2026-07-18T00:00:00.000Z");
  }

  async readCosts(gymId: string) {
    this.gymIds.push(gymId);
    return [];
  }
}

class FakeCloseReader implements ManagementMarginMonthlyCloseReader {
  constructor(
    private readonly row: ManagementMarginMonthlyCloseReadRow | null,
    private readonly rows: ManagementMarginMonthlyCloseReadRow[] = [],
  ) {}

  async readMonthlyClose() {
    return this.row;
  }

  async readMonthlyCloses() {
    return this.rows;
  }
}

function service(
  revenue = new FakeRevenueReader(),
  cost = new FakeCostReader(),
  close?: ManagementMarginMonthlyCloseReader,
) {
  return new ManagementMarginService(revenue, cost, close);
}

describe("ManagementMarginService", () => {
  test("usa el mes de negocio y conserva el alcance del gimnasio", async () => {
    const revenue = new FakeRevenueReader();
    const cost = new FakeCostReader();
    const result = await service(revenue, cost).get({ gymId: "gym-demo" });

    expect(result.mes).toBe("2026-07");
    expect(result.naturaleza).toBe("MARGEN_GERENCIAL");
    expect(result.estado_periodo).toBe("PROVISIONAL");
    expect(revenue.gymIds).toEqual(["gym-demo", "gym-demo"]);
    expect(cost.gymIds).toEqual(["gym-demo"]);
  });

  test("rechaza un gimnasio vacío antes de consultar datos", async () => {
    const revenue = new FakeRevenueReader();
    const cost = new FakeCostReader();
    await expect(
      service(revenue, cost).get({ gymId: "  " }),
    ).rejects.toBeInstanceOf(ManagementMarginServiceError);
    expect(revenue.gymIds).toEqual([]);
    expect(cost.gymIds).toEqual([]);
  });

  test("convierte un mes ambiguo en error de aplicación", async () => {
    await expect(
      service().get({ gymId: "gym-demo", month: "07/2026" }),
    ).rejects.toBeInstanceOf(ManagementMarginServiceError);
  });

  test("devuelve el resultado devengado firmado si existe snapshot R4.4", async () => {
    const signed = prepareManagementMarginForCertification({
      mes: "2026-06",
      naturaleza: "MARGEN_GERENCIAL",
      estado_periodo: "PROVISIONAL",
      cobertura: {
        membresias_evaluadas: 0,
        conceptos_costo_evaluados: 0,
        requieren_revision: 0,
        conceptos_costo_sin_ingreso: 0,
        completa: true,
      },
      monedas: [],
      limitaciones: [],
    }, "2026-06");
    const snapshot = JSON.stringify({
      version: 3,
      gym_id: "gym-demo",
      mes: "2026-06",
      firmado_por: { nombre: "Admin", rol: "admin" },
      motivo: "Cierre mensual de prueba.",
      timezone: "America/Havana",
      generado_at_utc: "2026-07-01T00:00:00.000Z",
      resultado_devengado: signed,
    });
    const result = await service(
      new FakeRevenueReader(),
      new FakeCostReader(),
      new FakeCloseReader({
        monthlyCloseId: "close-1",
        month: "2026-06",
        state: "CERRADO",
        sha256: createHash("sha256").update(snapshot).digest("hex"),
        snapshotJson: snapshot,
        closedAt: new Date("2026-07-01T00:00:00.000Z"),
        reopenedAt: null,
        lockKey: "lock-1",
      }),
    ).get({ gymId: "gym-demo", month: "2026-06" });

    expect(result.certificado).toBeTrue();
    expect(result.estado_periodo).toBe("CERTIFICADO");
    expect(result.cierre_tesoreria.snapshot_version).toBe(3);
  });

  test("compara el año usando solo snapshots R4.4 íntegros", async () => {
    const signed = prepareManagementMarginForCertification({
      mes: "2026-01",
      naturaleza: "MARGEN_GERENCIAL",
      estado_periodo: "PROVISIONAL",
      cobertura: {
        membresias_evaluadas: 1,
        conceptos_costo_evaluados: 1,
        requieren_revision: 0,
        conceptos_costo_sin_ingreso: 0,
        completa: true,
      },
      monedas: [{
        moneda_id: "cup",
        moneda_codigo: "CUP",
        ingreso_devengado_mes: "100.00",
        costo_directo_mes: "25.00",
        margen_directo_mes: "75.00",
        fijo_no_distribuido_mes: "5.00",
        margen_menos_fijo_mes: "70.00",
        ingreso_devengado_acumulado: "100.00",
        costo_directo_acumulado: "25.00",
        margen_directo_acumulado: "75.00",
        fijo_no_distribuido_acumulado: "5.00",
        margen_menos_fijo_acumulado: "70.00",
        atribucion: { costo_sin_plan: false, costo_sin_socio: false },
      }],
      limitaciones: [],
    }, "2026-01");
    const snapshot = JSON.stringify({
      version: 3,
      gym_id: "gym-demo",
      mes: "2026-01",
      resultado_devengado: signed,
    });
    const result = await service(
      new FakeRevenueReader(),
      new FakeCostReader(),
      new FakeCloseReader(null, [{
        monthlyCloseId: "close-jan",
        month: "2026-01",
        state: "CERRADO",
        sha256: createHash("sha256").update(snapshot).digest("hex"),
        snapshotJson: snapshot,
        closedAt: new Date("2026-02-01T00:00:00.000Z"),
        reopenedAt: null,
        lockKey: "lock-jan",
      }]),
    ).getAnnual({ gymId: "gym-demo", year: "2026" });

    expect(result.naturaleza)
      .toBe("COMPARATIVA_ANUAL_RESULTADO_DEVENGADO_CERTIFICADO");
    expect(result.cobertura.meses_certificados).toBe(1);
    expect(result.cobertura.meses_pendientes).toBe(5);
    expect(result.monedas[0].totales_devengo.margen_directo).toBe("75.00");
  });

  test("expone BLOQUEO_INVALIDO cuando un cierre CERRADO perdió su bloqueo", async () => {
    const snapshot = JSON.stringify({
      version: 3,
      gym_id: "gym-demo",
      mes: "2026-01",
      resultado_devengado: prepareManagementMarginForCertification({
        mes: "2026-01",
        naturaleza: "MARGEN_GERENCIAL",
        estado_periodo: "PROVISIONAL",
        cobertura: {
          membresias_evaluadas: 1,
          conceptos_costo_evaluados: 1,
          requieren_revision: 0,
          conceptos_costo_sin_ingreso: 0,
          completa: true,
        },
        monedas: [{
          moneda_id: "cup",
          moneda_codigo: "CUP",
          ingreso_devengado_mes: "100.00",
          costo_directo_mes: "25.00",
          margen_directo_mes: "75.00",
          fijo_no_distribuido_mes: "5.00",
          margen_menos_fijo_mes: "70.00",
          ingreso_devengado_acumulado: "100.00",
          costo_directo_acumulado: "25.00",
          margen_directo_acumulado: "75.00",
          fijo_no_distribuido_acumulado: "5.00",
          margen_menos_fijo_acumulado: "70.00",
          atribucion: { costo_sin_plan: false, costo_sin_socio: false },
        }],
        limitaciones: [],
      }, "2026-01"),
    });
    const result = await service(
      new FakeRevenueReader(),
      new FakeCostReader(),
      new FakeCloseReader(null, [{
        monthlyCloseId: "close-jan",
        month: "2026-01",
        state: "CERRADO",
        sha256: createHash("sha256").update(snapshot).digest("hex"),
        snapshotJson: snapshot,
        closedAt: new Date("2026-02-01T00:00:00.000Z"),
        reopenedAt: null,
        // R4.5.1: un CERRADO sin bloqueo activo no puede certificarse.
        lockKey: null,
      }]),
    ).getAnnual({ gymId: "gym-demo", year: "2026" });

    const jan = result.meses.find((item: { mes: string }) => item.mes === "2026-01");
    expect(jan.estado).toBe("BLOQUEO_INVALIDO");
    // No se certifica ni aporta al total del año.
    expect(result.cobertura.meses_certificados).toBe(0);
    expect(result.monedas).toEqual([]);
  });
});
