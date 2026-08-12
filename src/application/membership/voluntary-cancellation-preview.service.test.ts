import { describe, expect, test } from "bun:test";
import { buildVoluntaryCancellationPreview, VoluntaryCancellationPreviewError } from "./voluntary-cancellation-preview.service";

const base = { clientId: "100", clientName: "Carmen Cancelación", membershipId: "m1",
  planName: "Mensual", state: "ACTIVA", currencyId: "CUP", paid: 90,
  durationDays: 30, start: new Date("2026-07-24T00:00:00Z"),
  endExclusive: new Date("2026-08-23T00:00:00Z"), businessToday: new Date("2026-08-11T00:00:00Z") };

describe("previsualización remota de cancelación voluntaria", () => {
  test("devuelve la misma valoración segura que la API local", () => {
    const value = buildVoluntaryCancellationPreview(base);
    expect(value.valoracion).toMatchObject({ dias_consumidos: 18, dias_restantes: 12, valor_consumido: 54, valor_no_consumido: 36 });
    expect(value.alternativas.map((item) => item.tipo)).toEqual(["CREDITO_CLIENTE", "REEMBOLSO_PENDIENTE"]);
  });
  test("una pausa usa sus días congelados", () => {
    expect(buildVoluntaryCancellationPreview({ ...base, state: "PAUSADA", pausedRemainingDays: 9 }).valoracion.valor_no_consumido).toBe(27);
  });
  test("no vuelve a valorar una membresía cancelada", () => {
    expect(() => buildVoluntaryCancellationPreview({ ...base, state: "CANCELADA" })).toThrow(VoluntaryCancellationPreviewError);
  });
});
