/**
 * E0 y R5.3 — la web no puede tragarse la categoría ni la fecha de nacimiento.
 *
 * Encontrado el 10-08-2026 comparando las dos APIs con **el mismo cuerpo**:
 *
 *   escritorio -> categoria=VIEJO · fecha_nacimiento=1955-06-01
 *   web        -> categoria=NUEVO · fecha_nacimiento=NULL
 *
 * Tres omisiones encadenadas, y ninguna daba error: `categoria` no estaba en el
 * esquema del DTO, así que zod la descartaba antes de llegar a nadie; el caso
 * de uso no la pasaba; y el repositorio no escribía ni la categoría ni la
 * fecha. La respuesta devolvía «NUEVO» tan tranquila.
 *
 * Importa porque **la categoría decide el precio** (R5.3): un socio VIEJO dado
 * de alta desde la web se cobraba como nuevo. Es el mismo defecto que se
 * corrigió el 31-07 en `upsertFromSync` y que allí se quedó: se arregló la vía
 * de sincronización y no la del alta normal.
 *
 * Esta prueba vigila el primer eslabón, que es el que lo hacía silencioso.
 */
import { describe, expect, test } from "bun:test";
import { CreateClienteSchema, UpdateClienteSchema } from "./ClienteDTO";

const baseAlta = {
  ci: "55060151234",
  nombres: "Sonda",
  apellidos: "Categoría",
  sexo: "Masculino",
  estatura_cliente: 1.75,
  nacionalidad_id: "nac-1",
  fecha_inicio: "2026-08-10T00:00:00.000Z",
  fecha_fin: "2026-09-09T00:00:00.000Z",
  activo: true,
};

describe("DTO de cliente: categoría y fecha de nacimiento sobreviven al esquema", () => {
  test("el alta conserva la categoría en vez de descartarla en silencio", () => {
    const r = CreateClienteSchema.parse({ ...baseAlta, categoria: "VIEJO" });

    // Antes esto era `undefined`: zod quitaba el campo y el esquema de base de
    // datos ponía «NUEVO» por defecto sin que nadie se enterara.
    expect(r.categoria).toBe("VIEJO");
  });

  test("el alta conserva la fecha de nacimiento entrante", () => {
    const r = CreateClienteSchema.parse({
      ...baseAlta,
      fecha_nacimiento: "1985-04-20",
    });

    expect(r.fecha_nacimiento).toBe("1985-04-20");
  });

  test("la edición conserva la categoría", () => {
    expect(UpdateClienteSchema.parse({ categoria: "VIEJO" }).categoria).toBe("VIEJO");
  });

  test("no se admite una categoría inventada", () => {
    // La categoría no es texto libre: solo hay dos, y decide el precio.
    expect(() => CreateClienteSchema.parse({ ...baseAlta, categoria: "PREMIUM" })).toThrow();
  });

  test("sin categoría, el alta sigue valiendo y no la inventa", () => {
    // Un alta que no la manda es legítima; quien decide el defecto es el
    // caso de uso, no el esquema.
    const r = CreateClienteSchema.parse(baseAlta);

    expect(r.categoria).toBeUndefined();
  });

  test("una edición que no la manda no la toca", () => {
    const r = UpdateClienteSchema.parse({ telefono: "55512345" });

    // El caso de uso solo escribe la categoría si viene definida: editar un
    // teléfono no puede recategorizar a nadie.
    expect(r.categoria).toBeUndefined();
  });
});

/**
 * El motivo también tiene que sobrevivir al esquema.
 *
 * Se descubrió caminando el formulario en el navegador: el operador escribía el
 * motivo, el servidor respondía 400 pidiéndolo, y nadie mentía. `zod` lo
 * descartaba por no estar declarado —la misma trampa que se tragaba
 * `categoria`—. Ninguna prueba de servidor lo habría visto: todas mandaban el
 * cuerpo ya validado.
 */
describe("DTO de cliente: el motivo del cambio de categoría llega", () => {
  test("la edición conserva motivo_categoria", () => {
    const r = UpdateClienteSchema.parse({
      categoria: "VIEJO",
      motivo_categoria: "Volvió tras el cierre de la sede del Vedado.",
    });

    expect(r.motivo_categoria).toBe("Volvió tras el cierre de la sede del Vedado.");
  });

  test("sin motivo el campo queda ausente, no vacío", () => {
    expect(UpdateClienteSchema.parse({ categoria: "VIEJO" }).motivo_categoria).toBeUndefined();
  });
});
