import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  CONDICIONES_CONTRACTUALES,
  CondicionContractualError,
  detectarCambiosContractuales,
  exigirFlujoFormal,
  mensajeCambioContractual,
} from "./cliente-condiciones-contractuales";

/**
 * La ficha del socio dejaba cambiar cuatro condiciones del contrato sin pasar
 * por ningún flujo formal. La peor era el entrenador: existe
 * `POST /membresias/:id/cambiar-entrenador`, que previsualiza el efecto, exige
 * motivo, **cierra las cuotas de comisión y los devengos** del que sale y deja
 * aviso a administración. Cambiar el campo desde la ficha no hacía nada de eso.
 *
 * El plan decide el precio de los cobros futuros, y las fechas de cobertura
 * alargan el acceso al gimnasio sin que nadie haya pagado.
 */
const ALMACENADO = {
  ci: "91021020015",
  id_entrenador: "entrenador-1",
  id_planes_pago: "plan-1",
  fecha_inicio: new Date("2026-08-12T00:00:00.000Z"),
  fecha_fin: new Date("2026-09-11T00:00:00.000Z"),
  telefono: "55512345",
};

describe("condiciones contractuales: lo que la ficha no cambia", () => {
  it("bloquea el cambio de entrenador y dice por dónde se hace", () => {
    const cambios = detectarCambiosContractuales({
      entrante: { id_entrenador: "entrenador-2" },
      almacenado: ALMACENADO,
    });

    expect(cambios).toHaveLength(1);
    expect(cambios[0]!.campo).toBe("id_entrenador");
    expect(mensajeCambioContractual(cambios)).toContain("Cambiar entrenador");
  });

  it("bloquea el cambio de plan y el de las fechas de cobertura", () => {
    const cambios = detectarCambiosContractuales({
      entrante: {
        id_planes_pago: "plan-2",
        fecha_fin: "2026-12-31T00:00:00.000Z",
      },
      almacenado: ALMACENADO,
    });

    expect(cambios.map((c) => c.campo).sort()).toEqual([
      "fecha_fin",
      "id_planes_pago",
    ]);
  });

  it("lanza con 409: el dato no es inválido, el camino sí", () => {
    expect(() =>
      exigirFlujoFormal({
        entrante: { id_entrenador: "otro" },
        almacenado: ALMACENADO,
      }),
    ).toThrow(CondicionContractualError);

    try {
      exigirFlujoFormal({ entrante: { id_entrenador: "otro" }, almacenado: ALMACENADO });
    } catch (error: any) {
      expect(error.status).toBe(409);
    }
  });
});

/**
 * La mitad que de verdad decide si esto sirve o estorba. El formulario **reenvía
 * el modelo entero** en cada guardado, así que un socio con entrenador manda
 * `id_entrenador` siempre, lo haya tocado el operador o no. Si la regla no
 * comparara contra lo almacenado, cambiar un teléfono fallaría por culpa de un
 * plan que nadie miró.
 *
 * Es exactamente la trampa que ya costó una vuelta con la regla de categoría:
 * reenviar el mismo valor no es un cambio.
 */
describe("condiciones contractuales: lo que la ficha sí puede guardar", () => {
  it("reenviar los mismos valores no es un cambio", () => {
    const cambios = detectarCambiosContractuales({
      entrante: {
        id_entrenador: "entrenador-1",
        id_planes_pago: "plan-1",
        fecha_inicio: "2026-08-12T00:00:00.000Z",
        fecha_fin: "2026-09-11T00:00:00.000Z",
        telefono: "55599999",
      },
      almacenado: ALMACENADO,
    });

    expect(cambios).toEqual([]);
  });

  it("una fecha ISO completa y su día son la misma condición", () => {
    // El formulario manda el instante y la base guarda el día. Comparar cadenas
    // a pelo daría un falso cambio en cada guardado.
    expect(
      detectarCambiosContractuales({
        entrante: { fecha_fin: "2026-09-11T05:30:00.000Z" },
        almacenado: ALMACENADO,
      }),
    ).toEqual([]);
  });

  it("null, undefined y cadena vacía son lo mismo: sin entrenador", () => {
    const sinEntrenador = { ...ALMACENADO, id_entrenador: null };

    expect(
      detectarCambiosContractuales({
        entrante: { id_entrenador: "" },
        almacenado: sinEntrenador,
      }),
    ).toEqual([]);
  });

  it("un campo ausente no se juzga", () => {
    expect(
      detectarCambiosContractuales({ entrante: { telefono: "1" }, almacenado: ALMACENADO }),
    ).toEqual([]);
  });

  it("los datos personales siguen siendo libres", () => {
    expect(() =>
      exigirFlujoFormal({
        entrante: { telefono: "55500000", correo: "a@b.c", direccion: "Calle 1" },
        almacenado: ALMACENADO,
      }),
    ).not.toThrow();
  });
});

describe("la regla es la misma en las dos APIs", () => {
  it("los dos ficheros son idénticos", () => {
    // La causa raíz de media docena de defectos de este proyecto es que nadie
    // compara los gemelos. Aquí se compara el fichero entero.
    const local = readFileSync(
      resolve(import.meta.dir, "./cliente-condiciones-contractuales.ts"),
      "utf8",
    );
    const remoto = readFileSync(
      resolve(
        import.meta.dir,
        "../../../gym-local-api/src/domain/cliente-condiciones-contractuales.ts",
      ),
      "utf8",
    );

    expect(local).toBe(remoto);
  });

  it("cubre las cuatro condiciones, ni una menos", () => {
    expect(CONDICIONES_CONTRACTUALES.map((c) => c.campo).sort()).toEqual([
      "fecha_fin",
      "fecha_inicio",
      "id_entrenador",
      "id_planes_pago",
    ]);
  });
});
