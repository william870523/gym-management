import { describe, expect, test } from "bun:test";
import {
  classifyTrainerObligationAtCutoff,
  refundWasPendingAtCutoff,
} from "./operational-obligations-policy";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const instant = (value: string) => new Date(value);

const base = () => ({
  totalMinor: 10_001n,
  earningMethod: "PERIODOS_IGUALES",
  periodStart: date("2026-07-01"),
  periodEnd: date("2026-08-01"),
  scheduledDate: date("2026-08-01"),
  state: "PENDIENTE",
  createdAt: instant("2026-07-01T10:00:00.000Z"),
  updatedAt: instant("2026-07-01T10:00:00.000Z"),
  applications: [],
});

describe("operational obligations policy", () => {
  test("no llama ganado a un periodo igual todavía incompleto", () => {
    const result = classifyTrainerObligationAtCutoff(base(), date("2026-07-18"));
    expect(result.earnedPendingMinor).toBe(0n);
    expect(result.futurePendingMinor).toBe(10_001n);
  });

  test("prorratea DIAS_SERVICIO en centavos exactos", () => {
    const result = classifyTrainerObligationAtCutoff({
      ...base(),
      earningMethod: "DIAS_SERVICIO",
      periodStart: date("2026-07-01"),
      periodEnd: date("2026-07-04"),
      totalMinor: 100n,
    }, date("2026-07-03"));
    expect(result.earnedPendingMinor).toBe(67n);
    expect(result.futurePendingMinor).toBe(33n);
  });

  test("una aplicación vigente reduce primero lo ganado", () => {
    const result = classifyTrainerObligationAtCutoff({
      ...base(),
      periodEnd: date("2026-07-10"),
      scheduledDate: date("2026-07-15"),
      totalMinor: 10_000n,
      applications: [{
        amountMinor: 4_000n,
        state: "APLICADA",
        createdAt: instant("2026-07-16T12:00:00.000Z"),
        updatedAt: instant("2026-07-16T12:00:00.000Z"),
      }],
    }, date("2026-07-18"));
    expect(result.earnedPendingMinor).toBe(6_000n);
    expect(result.payableNowMinor).toBe(6_000n);
    expect(result.overdue).toBeTrue();
  });

  test("reconstruye una aplicación que fue reversada después del corte", () => {
    const result = classifyTrainerObligationAtCutoff({
      ...base(),
      periodEnd: date("2026-07-10"),
      totalMinor: 10_000n,
      applications: [{
        amountMinor: 4_000n,
        state: "REVERSADA",
        createdAt: instant("2026-07-11T12:00:00.000Z"),
        updatedAt: instant("2026-07-20T12:00:00.000Z"),
      }],
    }, date("2026-07-18"));
    expect(result.earnedPendingMinor).toBe(6_000n);
  });

  test("sigue los ciclos pendiente, resuelto y reabierto del reembolso", () => {
    const request = {
      requestedAt: instant("2026-07-01T12:00:00.000Z"),
      events: [
        { type: "RESUELTO" as const, occurredAt: instant("2026-07-05T12:00:00.000Z") },
        { type: "REABIERTO" as const, occurredAt: instant("2026-07-10T12:00:00.000Z") },
      ],
    };
    expect(refundWasPendingAtCutoff(request, date("2026-07-04"))).toBeTrue();
    expect(refundWasPendingAtCutoff(request, date("2026-07-08"))).toBeFalse();
    expect(refundWasPendingAtCutoff(request, date("2026-07-12"))).toBeTrue();
  });
});
