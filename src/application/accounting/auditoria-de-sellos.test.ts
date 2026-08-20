import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { auditarSellosDeCertificados } from "./auditoria-de-sellos";

/**
 * §6.4 — el repaso de sellos, que usan por igual el script de mano y la pasada
 * programada.
 *
 * Lo que se fija aquí es lo que hace útil un informe de integridad: que **mire
 * todos** —incluidos los retirados, que siguen siendo la prueba de lo que se
 * cerró aquel día— y que **nombre** los rotos, porque «hay uno roto» sin decir
 * cuál obliga a buscarlo a mano justo cuando hay prisa.
 */
const selloDe = (texto: string) => createHash("sha256").update(texto).digest("hex");

const fila = (id: string, texto: string, sello: string, extra: Record<string, unknown> = {}) => ({
  certificado_id: id,
  foto_json: texto,
  foto_sha256: sello,
  estado: "VIGENTE",
  is_deleted: false,
  ciclo_numero: 1,
  fecha_inicio: new Date(Date.UTC(2026, 7, 1)),
  fecha_fin_exclusiva: new Date(Date.UTC(2026, 8, 1)),
  ...extra,
});

const lector = (filas: any[]) => ({
  cierreCadenaCertificado: { findMany: async () => filas },
});

describe("auditarSellosDeCertificados", () => {
  it("da por intacto el que cuadra y nombra el que no", async () => {
    const bueno = '{"ingreso":"1200.00"}';
    const tocado = '{"ingreso":"9200.00"}';
    const r = await auditarSellosDeCertificados(
      lector([
        fila("ccc-bueno", bueno, selloDe(bueno)),
        // El caso que engaña: el sello es de verdad y el texto no.
        fila("ccc-roto", tocado, selloDe(bueno)),
      ]) as never,
    );

    expect(r.revisados).toBe(2);
    expect(r.intactos).toBe(1);
    expect(r.rotos).toEqual(["ccc-roto"]);
  });

  it("repasa también los retirados", async () => {
    // Un certificado anulado se conserva porque es la prueba de lo que se cerró
    // aquel día. Si su sello dejara de cuadrar, esa prueba ya no vale, así que
    // saltárselo sería dejar sin vigilancia justo lo que solo sirve como prueba.
    const texto = '{"periodo":"2026-07"}';
    const r = await auditarSellosDeCertificados(
      lector([
        fila("ccc-anulado", texto, "0".repeat(64), {
          estado: "ANULADO",
          is_deleted: true,
        }),
      ]) as never,
    );

    expect(r.revisados).toBe(1);
    expect(r.rotos).toEqual(["ccc-anulado"]);
    expect(r.detalle[0].retirado).toBeTrue();
  });

  it("sin certificados no inventa un resultado bueno", async () => {
    // Cero revisados y cero rotos no es «todo correcto»: es que no había nada.
    // Quien lee tiene que poder distinguirlo, y por eso se publica `revisados`.
    const r = await auditarSellosDeCertificados(lector([]) as never);

    expect(r.revisados).toBe(0);
    expect(r.intactos).toBe(0);
    expect(r.rotos).toEqual([]);
  });
});
