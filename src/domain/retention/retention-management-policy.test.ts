import { expect, test } from "bun:test";
import { normalizeRetentionManagement } from "./retention-management-policy";

test("remote retention management keeps promise date explicit", () => {
  const promise = new Date("2026-07-16T00:00:00.000Z");
  const result = normalizeRetentionManagement({
    result: "PROMESA_PAGO",
    channel: "LLAMADA",
    businessToday: new Date("2026-07-13T00:00:00.000Z"),
    promiseDate: promise,
  });
  expect(result.nextManagementDate).toEqual(promise);
});

// --- E0-b: motivo de baja codificado (docs/PLAN_ESTADISTICAS.md §7-ter) ---

const HOY = new Date("2026-07-27T00:00:00.000Z");

test("no desea renovar exige motivo: sin él solo se sabe cuántos se van, no por qué", () => {
  expect(() =>
    normalizeRetentionManagement({
      result: "NO_DESEA_RENOVAR",
      channel: "LLAMADA",
      note: "Dice que le queda lejos",
      businessToday: HOY,
    }),
  ).toThrow("Seleccione el motivo");
});

test("no desea renovar con motivo pasa y lo conserva", () => {
  const normalizado = normalizeRetentionManagement({
    result: "NO_DESEA_RENOVAR",
    channel: "LLAMADA",
    note: "Dice que le queda lejos",
    reasonId: "mbaja-mudanza",
    businessToday: HOY,
  });
  expect(normalizado.reasonId).toBe("mbaja-mudanza");
});

test("contactado admite motivo sin haberse ido: es aviso temprano, no baja", () => {
  const normalizado = normalizeRetentionManagement({
    result: "CONTACTADO",
    channel: "WHATSAPP",
    note: "Dice que este mes está caro",
    reasonId: "mbaja-precio",
    businessToday: HOY,
  });
  expect(normalizado.reasonId).toBe("mbaja-precio");
});

test("contactado sin motivo sigue siendo válido", () => {
  const normalizado = normalizeRetentionManagement({
    result: "CONTACTADO",
    channel: "SMS",
    businessToday: HOY,
  });
  expect(normalizado.reasonId).toBeNull();
});

test("no localizado no lleva motivo: nadie pudo preguntarlo", () => {
  expect(() =>
    normalizeRetentionManagement({
      result: "NO_LOCALIZADO",
      channel: "LLAMADA",
      reasonId: "mbaja-precio",
      businessToday: HOY,
    }),
  ).toThrow("nadie pudo preguntarlo");
});

test("el motivo en blanco cuenta como ausente, no como cadena vacía", () => {
  const normalizado = normalizeRetentionManagement({
    result: "CONTACTADO",
    channel: "LLAMADA",
    reasonId: "   ",
    businessToday: HOY,
  });
  expect(normalizado.reasonId).toBeNull();
});
