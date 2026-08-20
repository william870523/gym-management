import { describe, expect, test } from "bun:test";
import { CreateAsistenciaUseCase } from "./CreateAsistenciaUseCase";

/**
 * §5.2 — la entrada de un visitante deja escrito **con qué se decidió**, también
 * cuando la registra la web.
 *
 * En el concentrador la respuesta es la misma siempre —decide él, con el dato de
 * origen en este instante— y por eso conviene fijarla: es fácil copiar aquí el
 * cálculo de la instalación y acabar escribiendo «lleva dos días sin noticias»
 * en una fila que se decidió contra la base buena.
 *
 * Con dobles y no contra MariaDB a propósito: lo que se comprueba es qué se
 * escribe en la fila, no si la base la acepta, y montar un visitante real
 * exigiría copia, acceso y sede ajena para observar tres columnas.
 */
const FECHA_NEGOCIO = new Date(Date.UTC(2026, 7, 20));

function casoDeUso(esPropio: boolean) {
  const escritas: any[] = [];
  const repo: any = {
    create: async (data: any) => {
      escritas.push(data);
    },
  };
  const elegibilidad: any = {
    entradaAbierta: async () => null,
    fechaDeNegocio: async () => FECHA_NEGOCIO,
    esSocioDeLaSede: async () => esPropio,
    membresiasParaEntrada: async () => [
      { estado: "ACTIVA", fechaFin: new Date(Date.UTC(2026, 11, 31)), bloqueoPorCuota: null },
    ],
    visitante: async () => ({
      copia: {
        ci: "RDR000000001",
        gym_id_origen: "otra-sede",
        membresia_estado: "ACTIVA",
        membresia_fecha_fin: new Date(Date.UTC(2026, 11, 31)),
        is_deleted: false,
      },
      acceso: {
        activo: true,
        is_deleted: false,
        vigente_hasta: new Date(Date.UTC(2026, 11, 31)),
      },
    }),
  };
  return {
    escritas,
    ejecutar: () =>
      new CreateAsistenciaUseCase(repo, elegibilidad).execute(
        { ci: "RDR000000001" } as any,
        "gym-visitada",
      ),
  };
}

describe("§5.2 · el rastro de la decisión en la web", () => {
  test("un visitante queda marcado como decidido en el concentrador", async () => {
    const { escritas, ejecutar } = casoDeUso(false);
    await ejecutar();

    expect(escritas).toHaveLength(1);
    expect(escritas[0].decidido_con).toBe("CONCENTRADOR");
    // Cero días, y no un retraso calculado: al origen no se le pregunta cuánto
    // hace que bajó datos, porque no baja.
    expect(escritas[0].conocimiento_al_decidir).toBe("AL_DIA");
    expect(escritas[0].dias_sin_noticias).toBe(0);
    // Del segundo eje —cuánto hace que se supo de la sede del socio— no se
    // afirma nada si no se pudo medir. `NO_CONSTA` no es `AL_DIA`: el
    // concentrador está al día consigo mismo, no con esa sede.
    expect(escritas[0].conocimiento_origen_al_decidir).toBe("NO_CONSTA");
    expect(escritas[0].dias_sin_noticias_origen).toBeNull();
  });

  test("un socio de la casa no inventa rastro", async () => {
    // `null` es «no aplica»: se decidió con sus propias membresías, que están
    // aquí. Escribir CONCENTRADOR en todas las filas haría la columna inútil.
    const { escritas, ejecutar } = casoDeUso(true);
    await ejecutar();

    expect(escritas[0].decidido_con).toBeNull();
    expect(escritas[0].conocimiento_al_decidir).toBeNull();
    expect(escritas[0].dias_sin_noticias).toBeNull();
    expect(escritas[0].conocimiento_origen_al_decidir).toBeNull();
    expect(escritas[0].dias_sin_noticias_origen).toBeNull();
  });
});
