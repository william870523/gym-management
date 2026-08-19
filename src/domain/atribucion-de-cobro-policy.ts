/**
 * De quién es el ingreso de un cobro que llega por sincronización (M4c,
 * docs/MULTI_SEDE.md §5.3 y §7.10).
 *
 * ## La avería que este módulo existe para impedir
 *
 * Hasta M4c, la subida sellaba `gym_id: input.gymId` —la sede del dispositivo—
 * sobre cada cobro, sin preguntar. Mientras nadie pudiera cobrar fuera de su
 * sede eso era correcto y barato. Con el cobro cruzado deja de serlo, y de la
 * peor manera posible: un cobro hecho en Oeste para un socio de Centro **no
 * daría error**, llegaría al concentrador convertido en ingreso de Oeste.
 *
 * Sin excepción, sin cuarentena, sin nada que lo delate. El margen de Oeste
 * inflado, el de Centro corto, y el consolidado cuadrando. Es exactamente el
 * «ingreso mal atribuido» que §7.10 llama el riesgo contable más caro, y la
 * diferencia entre **rechazar** y **reescribir** es toda la diferencia: un
 * rechazo se ve en la cuarentena y alguien lo mira; una reescritura no la ve
 * nadie nunca.
 *
 * ## La regla
 *
 * El emisor puede declarar que el ingreso es de otra sede, pero solo si:
 *
 *   1. dice que **él mismo** fue quien cobró —nadie puede declarar que cobró un
 *      tercero—, y
 *   2. el socio es de esa otra sede y tiene el plus vigente, lo que se
 *      comprueba contra la base, no contra el payload.
 *
 * Cualquier otra combinación **se rechaza**. No se corrige, no se normaliza y
 * no se sella: se manda a cuarentena para que se vea.
 *
 * ## Dónde va el efectivo, y por qué el detalle no lo lleva
 *
 * El detalle del cobro sigue al **ingreso**: los informes de la sede dueña
 * cruzan pagos y detalles por el mismo `gym_id`, así que un detalle sellado con
 * la sede que cobró desaparecería de los informes de la sede que ingresó.
 *
 * Y por eso el detalle de un cobro por cuenta ajena viaja **sin cuenta**: su
 * `cuenta_id` sería una caja de otra sede, y esa referencia cruzada obligaría a
 * abrir el aislamiento para las cuentas —un frente nuevo por un dato que ya
 * está bien guardado en otro sitio—. Dónde entró el efectivo lo dice el
 * movimiento de tesorería de la sede que cobró, que es quien tiene que
 * cuadrarlo en su arqueo. El detalle dice **cómo** se pagó; la tesorería, **en
 * qué caja**.
 *
 * Función pura y gemela byte a byte entre las dos APIs.
 */

export const MOTIVO_COBRADOR_AJENO =
  "El cobro declara que lo recibió otra sede: solo se puede declarar el cobro propio.";
export const MOTIVO_INGRESO_AJENO_SIN_AUTORIZACION =
  "El cobro atribuye el ingreso a otra sede sin que el socio tenga acceso multi-sede vigente allí.";
export const MOTIVO_SEDE_AUSENTE =
  "El cobro no identifica la sede del dispositivo que lo sube.";

export type ClaseDeAtribucion = "PROPIO" | "POR_CUENTA_AJENA";

export type AtribucionDeCobro = {
  readonly clase: ClaseDeAtribucion;
  /** Sede a la que se atribuye el INGRESO. Es el `gym_id` de la fila. */
  readonly gymIdDelIngreso: string;
  /** Sede en cuya caja entró el efectivo. */
  readonly cobradoEnGymId: string;
  /**
   * `true` cuando el detalle debe viajar sin cuenta: la caja es de otra sede y
   * el dato vive en el movimiento de tesorería de quien cobró.
   */
  readonly detalleSinCuenta: boolean;
};

export type ResultadoDeAtribucion =
  | { readonly ok: true; readonly atribucion: AtribucionDeCobro }
  | { readonly ok: false; readonly motivo: string };

const limpio = (valor: unknown): string => String(valor ?? "").trim();

/**
 * Decide la atribución de un cobro que sube, o la rechaza.
 *
 * **Nunca devuelve una atribución “corregida” en silencio.** Ante cualquier
 * incoherencia contesta `ok: false` y quien llama lo manda a cuarentena.
 */
export function atribuirCobro(input: {
  /** Sede del dispositivo autenticado: quien sube, y por tanto quien cobró. */
  gymIdDelDispositivo: unknown;
  /** `gym_id` que trae el payload. Vacío significa «el mío», por compatibilidad. */
  gymIdDeclaradoDelIngreso: unknown;
  /** `cobrado_en_gym_id` que trae el payload. Vacío significa «el mío». */
  cobradoEnDeclarado: unknown;
  /**
   * El socio pertenece a la sede que el payload declara como dueña del ingreso
   * **y** tiene el plus vigente allí. Se comprueba contra la base.
   */
  socioAutorizadoEnLaSedeDeclarada: boolean;
}): ResultadoDeAtribucion {
  const dispositivo = limpio(input.gymIdDelDispositivo);
  if (!dispositivo) return { ok: false, motivo: MOTIVO_SEDE_AUSENTE };

  const ingreso = limpio(input.gymIdDeclaradoDelIngreso) || dispositivo;
  const cobradoEn = limpio(input.cobradoEnDeclarado) || dispositivo;

  // Nadie puede declarar que cobró un tercero: el efectivo entró donde está el
  // dispositivo, y decir otra cosa movería una deuda a una caja ajena.
  if (cobradoEn !== dispositivo) {
    return { ok: false, motivo: MOTIVO_COBRADOR_AJENO };
  }

  if (ingreso === dispositivo) {
    return {
      ok: true,
      atribucion: {
        clase: "PROPIO",
        gymIdDelIngreso: dispositivo,
        cobradoEnGymId: dispositivo,
        detalleSinCuenta: false,
      },
    };
  }

  if (input.socioAutorizadoEnLaSedeDeclarada !== true) {
    return { ok: false, motivo: MOTIVO_INGRESO_AJENO_SIN_AUTORIZACION };
  }

  return {
    ok: true,
    atribucion: {
      clase: "POR_CUENTA_AJENA",
      gymIdDelIngreso: ingreso,
      cobradoEnGymId: dispositivo,
      detalleSinCuenta: true,
    },
  };
}

/** ¿Este cobro deja saldo entre partes? Atajo con nombre, para leerlo mejor. */
export function dejaSaldoEntrePartes(atribucion: AtribucionDeCobro): boolean {
  return atribucion.clase === "POR_CUENTA_AJENA";
}
