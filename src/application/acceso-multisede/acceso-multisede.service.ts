/**
 * Productor del acceso multi-sede (M4a): el precio global del plus y la
 * suscripción de cada socio.
 *
 * Recibe el `tx` y **devuelve lo que cambió** en vez de registrar el evento por
 * su cuenta. Es el mismo reparto que `rate-surcharge-scope.service.ts` y no es
 * casual: quien abre la transacción es quien tiene que cerrar la fila y su
 * `sync_log` **juntos**. Un servicio que registrara el evento con el prisma
 * global reabriría la avería que costó cerrar el 12-08 —fila escrita, evento
 * perdido, y nada que lo delate porque la fila existe—.
 *
 * **Esta función es gemela de la de la otra API. Si cambia una, cambia la
 * otra**; la prueba de paridad de la raíz compara los dos ficheros enteros.
 */
import {
  accesoMultisedeId,
  debeReplicarse,
  proximaVigencia,
  type AccesoMultisede,
} from "../../domain/acceso-multisede-policy";
import { normalizeMoney } from "../../domain/money";
import { decidirCobro } from "../../domain/cobro-por-cuenta-ajena-policy";
import {
  cotizarVisita,
  type CotizacionDeVisita,
} from "../../domain/cotizacion-visita-policy";
import { anotarAsiento } from "../saldo-enlace/saldo-enlace.service";

/**
 * El precio del plus es uno solo para toda la cadena, así que su fila también.
 * Un identificador fijo —en vez de un aleatorio— es lo que hace que las dos
 * bases converjan sobre la MISMA fila en vez de acumular una por base.
 */
export const PRECIO_ACCESO_MULTISEDE_ID = "GLOBAL";

/** Error del productor con el código estable que la vista puede interpretar. */
export class AccesoMultisedeError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "AccesoMultisedeError";
  }
}

export type CambioAcceso<T> = {
  operation: "INSERT" | "UPDATE";
  row: T;
};

/** Precio vigente del plus, o `null` si el dueño todavía no lo ha fijado. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function leerPrecioGlobal(tx: any) {
  return tx.accesoMultisedePrecio.findFirst({
    where: { acceso_multisede_precio_id: PRECIO_ACCESO_MULTISEDE_ID, is_deleted: false },
  });
}

/**
 * Fija el precio global del plus.
 *
 * No toca ningún `precio_snapshot` ya congelado, y eso es deliberado: subir el
 * precio no puede reescribir lo que alguien ya pagó (§9-bis, mismo criterio que
 * el recargo por mora). El precio nuevo rige desde la siguiente marca.
 */
export async function fijarPrecioGlobal(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  precio: unknown;
  monedaId: unknown;
  sourceDevice: string;
  nowUtc: Date;
}) {
  const { tx, sourceDevice, nowUtc } = input;

  // El cuerpo HTTP llega sin tipar. Se acota antes de entrar al contrato de
  // dinero: texto —la forma exacta, la que manda Prisma Decimal— o número, que
  // es lo que todavía envían algunos formularios.
  const bruto = input.precio;
  let precio: string;
  try {
    if (typeof bruto !== "string" && typeof bruto !== "number") {
      throw new Error("tipo no admitido");
    }
    precio = normalizeMoney(bruto);
  } catch {
    throw new AccesoMultisedeError(
      400,
      "ACCESO_MULTISEDE_PRECIO_INVALIDO",
      "El precio del acceso multi-sede tiene que ser un importe con dos decimales.",
    );
  }
  if (precio.startsWith("-")) {
    throw new AccesoMultisedeError(
      400,
      "ACCESO_MULTISEDE_PRECIO_INVALIDO",
      "El precio del acceso multi-sede no puede ser negativo.",
    );
  }

  const monedaId = String(input.monedaId ?? "").trim();
  const moneda = monedaId
    ? await tx.moneda.findFirst({
        where: { moneda_id: monedaId, is_deleted: false },
        select: { moneda_id: true },
      })
    : null;
  if (!moneda) {
    throw new AccesoMultisedeError(
      400,
      "ACCESO_MULTISEDE_MONEDA_INVALIDA",
      "La moneda del acceso multi-sede no existe o está retirada.",
    );
  }

  const previo = await tx.accesoMultisedePrecio.findUnique({
    where: { acceso_multisede_precio_id: PRECIO_ACCESO_MULTISEDE_ID },
  });
  const row = await tx.accesoMultisedePrecio.upsert({
    where: { acceso_multisede_precio_id: PRECIO_ACCESO_MULTISEDE_ID },
    create: {
      acceso_multisede_precio_id: PRECIO_ACCESO_MULTISEDE_ID,
      precio,
      moneda_id: monedaId,
      source_device: sourceDevice,
      is_deleted: false,
      created_at: nowUtc,
      updated_at: nowUtc,
      version: 1,
      deleted_at: null,
    },
    update: {
      precio,
      moneda_id: monedaId,
      source_device: sourceDevice,
      is_deleted: false,
      deleted_at: null,
      updated_at: nowUtc,
      version: { increment: 1 },
    },
  });
  return { operation: previo ? "UPDATE" : "INSERT", row } as CambioAcceso<typeof row>;
}

/**
 * Marca o renueva el acceso multi-sede de un socio.
 *
 * Tres cosas que decide y conviene no perder de vista:
 *
 * 1. **`gym_id` es la sede dueña del socio**, no la que lo marca. Recepción de
 *    la sede B puede vender el plus a un socio de A —el dinero cruza desde el
 *    día uno (§5.3)—, pero el socio sigue siendo de A. Estampar aquí la sede
 *    que marca convertiría la venta en un traslado de socio.
 * 2. **El precio se congela.** `precio_snapshot` sale del global del momento;
 *    un cambio posterior no reescribe cobros hechos.
 * 3. **Marcar dos veces renueva, no duplica.** La clave determinista por `ci` y
 *    la unicidad de la tabla lo garantizan incluso si dos sedes lo intentan a
 *    la vez.
 */
export async function marcarAccesoMultisede(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  /** Sede que está marcando; solo se guarda como rastro. */
  marcadoEnGymId: string;
  marcadoPorUserId: string;
  /** Fecha de negocio del gimnasio, no la del dispositivo. */
  fechaNegocio: Date;
  sourceDevice: string;
  nowUtc: Date;
  meses?: number;
}) {
  const { tx, marcadoEnGymId, marcadoPorUserId, sourceDevice, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();

  const cliente = ci
    ? await tx.cliente.findFirst({
        where: { ci, is_deleted: false },
        select: { ci: true, gym_id: true },
      })
    : null;
  if (!cliente) {
    throw new AccesoMultisedeError(
      404,
      "CLIENTE_NO_ENCONTRADO",
      "No existe un socio activo con esa identificación.",
    );
  }

  const precio = await leerPrecioGlobal(tx);
  if (!precio) {
    // Falla cerrado a propósito: sin precio no hay `precio_snapshot` que
    // congelar, y marcar con un cero implícito dejaría accesos gratuitos
    // pegados a socios reales que después habría que perseguir uno a uno.
    throw new AccesoMultisedeError(
      409,
      "ACCESO_MULTISEDE_SIN_PRECIO",
      "El acceso multi-sede no tiene precio configurado. Fíjelo desde la administración de la cadena antes de venderlo.",
    );
  }

  const id = accesoMultisedeId(ci);
  const previo: (AccesoMultisede & { cliente_acceso_multisede_id: string }) | null =
    await tx.clienteAccesoMultisede.findUnique({
      where: { cliente_acceso_multisede_id: id },
    });

  // Un acceso retirado o borrado no aporta días: se renueva desde hoy. Solo
  // encadena lo que de verdad estaba cubriendo.
  const vigenteHastaActual =
    previo && previo.activo && !previo.is_deleted ? previo.vigente_hasta : null;
  const vigenteHasta = proximaVigencia({
    vigenteHastaActual,
    fechaNegocio: input.fechaNegocio,
    meses: input.meses,
  });

  const comun = {
    ci,
    gym_id: cliente.gym_id ?? null,
    activo: true,
    vigente_hasta: vigenteHasta,
    precio_snapshot: normalizeMoney(precio.precio),
    moneda_id: precio.moneda_id,
    marcado_por_user_id: marcadoPorUserId,
    marcado_en_gym_id: marcadoEnGymId,
    source_device: sourceDevice,
    is_deleted: false,
    deleted_at: null,
  };

  const row = await tx.clienteAccesoMultisede.upsert({
    where: { cliente_acceso_multisede_id: id },
    create: {
      cliente_acceso_multisede_id: id,
      ...comun,
      created_at: nowUtc,
      updated_at: nowUtc,
      version: 1,
    },
    update: { ...comun, updated_at: nowUtc, version: { increment: 1 } },
  });
  return { operation: previo ? "UPDATE" : "INSERT", row } as CambioAcceso<typeof row>;
}

/**
 * Proyecta la copia de solo lectura del socio para el resto de sedes
 * (docs/MULTI_SEDE.md §5.2).
 *
 * **Lleva a la persona, no su caja.** Identidad, foto y el estado de su
 * membresía en origen; ni pagos, ni plan, ni entrenador, ni historial. Lo que
 * la sede visitada necesita es reconocerlo en el mostrador y saber si su
 * membresía cubre; para cobrarle hace falta el cobro cruzado, que es M4b.
 *
 * `membresia_fecha_fin` sale de la membresía viva con la cobertura más larga, y
 * no de `cliente.fecha_fin`, porque esa proyección se recalcula por otros
 * caminos y las dos podrían discrepar justo en el socio que está en la puerta.
 */
export async function proyectarVisitante(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  sourceDevice: string;
  nowUtc: Date;
}) {
  const { tx, sourceDevice, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();
  const cliente = await tx.cliente.findFirst({
    where: { ci, is_deleted: false },
    select: {
      ci: true,
      gym_id: true,
      nombres: true,
      apellidos: true,
      tipo_documento: true,
      foto_cliente: true,
      fecha_fin: true,
    },
  });
  if (!cliente) {
    throw new AccesoMultisedeError(
      404,
      "CLIENTE_NO_ENCONTRADO",
      "No existe un socio activo con esa identificación.",
    );
  }

  const membresia = await tx.membresiaCliente.findFirst({
    where: { ci, is_deleted: false },
    orderBy: { fecha_fin: "desc" },
    select: { estado: true, fecha_fin: true },
  });

  const comun = {
    gym_id_origen: cliente.gym_id ?? "",
    nombres: cliente.nombres,
    apellidos: cliente.apellidos,
    tipo_documento: cliente.tipo_documento ?? "DESCONOCIDO",
    foto_cliente: cliente.foto_cliente ?? null,
    membresia_estado: membresia?.estado ?? null,
    membresia_fecha_fin: membresia?.fecha_fin ?? cliente.fecha_fin ?? null,
    source_device: sourceDevice,
    is_deleted: false,
    deleted_at: null,
  };

  const previo = await tx.clienteVisitante.findUnique({ where: { ci } });
  const row = await tx.clienteVisitante.upsert({
    where: { ci },
    create: { ci, ...comun, created_at: nowUtc, updated_at: nowUtc, version: 1 },
    update: { ...comun, updated_at: nowUtc, version: { increment: 1 } },
  });
  return { operation: previo ? "UPDATE" : "INSERT", row } as CambioAcceso<typeof row>;
}

/**
 * Proyecta la **cotización de visita**: lo que la sede visitada necesita para
 * cobrarle sin conexión (M4c, docs/MULTI_SEDE.md §5.3).
 *
 * Va aparte de la copia de identidad y con su propio evento porque responde
 * otra pregunta —«qué le cobro», no «quién es»— y cambia con otra frecuencia:
 * cada pago, cada renovación y cada cambio de precio de su sede.
 *
 * **El descuento se resuelve aquí y viaja resuelto**: depende de la
 * configuración de esta sede, que no se replica ni debe. **La mora viaja como
 * regla**, no como importe, para que la cotización no caduque en veinticuatro
 * horas: quien cobra recalcula el recargo contra los días de atraso del día en
 * que cobra.
 *
 * Devuelve `null` cuando el socio no tiene plan vigente que cotizar. No es un
 * error: es un socio al que, hoy, otra sede no puede cobrarle nada.
 */
export async function proyectarCotizacionDeVisita(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  /** Resuelve el descuento del socio contra la configuración de SU sede. */
  resolverDescuento: (entrada: {
    gymId: string;
    ci: string;
    planId: string;
    numeroCuota?: number | null;
  }) => Promise<{
    precio_lista: string;
    precio_final: string;
    categoria_cliente: string;
    plan_codigo: string;
  }>;
  sourceDevice: string;
  nowUtc: Date;
}) {
  const { tx, sourceDevice, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();

  const socio = await tx.cliente.findFirst({
    where: { ci, is_deleted: false },
    select: { ci: true, gym_id: true },
  });
  if (!socio?.gym_id) return null;

  const membresia = await tx.membresiaCliente.findFirst({
    where: { ci, gym_id: socio.gym_id, is_deleted: false, estado: { in: ["ACTIVA", "PENDIENTE_PAGO"] } },
    orderBy: { fecha_fin: "desc" },
    select: { membresia_id: true, id_planes_pago: true, fecha_fin: true },
  });
  if (!membresia?.id_planes_pago) return null;

  const plan = await tx.planesPago.findFirst({
    where: { id_planes_pago: membresia.id_planes_pago, is_deleted: false },
    select: {
      id_planes_pago: true,
      nombre_plan_pago: true,
      moneda_id: true,
      recargo_mora_modo: true,
      recargo_mora_valor: true,
      recargo_mora_tope: true,
      recargo_mora_activo: true,
    },
  });
  if (!plan) return null;

  // La cuota que toca: la primera pendiente. Si no va por cuotas no hay
  // ninguna y manda el precio del plan.
  const cuota = await tx.membresiaCuota.findFirst({
    where: {
      membresia_id: membresia.membresia_id,
      gym_id: socio.gym_id,
      is_deleted: false,
      estado: "PENDIENTE",
    },
    orderBy: { numero_cuota: "asc" },
    select: { numero_cuota: true, importe: true, fecha_exigible: true },
  });

  const descuento = await input.resolverDescuento({
    gymId: socio.gym_id,
    ci,
    planId: plan.id_planes_pago,
    numeroCuota: cuota?.numero_cuota ?? null,
  });

  const comun = {
    gym_id_origen: socio.gym_id,
    plan_id: plan.id_planes_pago,
    plan_codigo: descuento.plan_codigo,
    plan_nombre: plan.nombre_plan_pago,
    moneda_id: plan.moneda_id,
    precio_lista: normalizeMoney(descuento.precio_lista),
    precio_final: normalizeMoney(descuento.precio_final),
    categoria_cliente: descuento.categoria_cliente,
    cubre_hasta: membresia.fecha_fin ?? null,
    mora_activo: plan.recargo_mora_activo === true,
    mora_modo: plan.recargo_mora_modo ?? null,
    mora_valor: plan.recargo_mora_valor == null ? null : String(plan.recargo_mora_valor),
    mora_tope: plan.recargo_mora_tope == null ? null : String(plan.recargo_mora_tope),
    cuota_numero: cuota?.numero_cuota ?? null,
    cuota_importe: cuota ? normalizeMoney(cuota.importe) : null,
    cuota_fecha_exigible: cuota?.fecha_exigible ?? null,
    calculada_al: nowUtc,
    source_device: sourceDevice,
    is_deleted: false,
    deleted_at: null,
  };

  const previo = await tx.clienteVisitanteCotizacion.findUnique({ where: { ci } });
  const row = await tx.clienteVisitanteCotizacion.upsert({
    where: { ci },
    create: { ci, ...comun, created_at: nowUtc, updated_at: nowUtc, version: 1 },
    update: { ...comun, updated_at: nowUtc, version: { increment: 1 } },
  });
  return { operation: previo ? "UPDATE" : "INSERT", row } as CambioAcceso<typeof row>;
}

/**
 * Retira la cotización. Va de la mano de la copia: un socio al que ya no se
 * puede reconocer tampoco se le puede cobrar, y dejar el precio suelto sería
 * dejar una oferta viva de alguien que ya no viene.
 */
export async function retirarCotizacionDeVisita(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  sourceDevice: string;
  nowUtc: Date;
}) {
  const { tx, sourceDevice, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();
  const previo = await tx.clienteVisitanteCotizacion.findUnique({ where: { ci } });
  if (!previo || previo.is_deleted) return null;
  const row = await tx.clienteVisitanteCotizacion.update({
    where: { ci },
    data: {
      is_deleted: true,
      deleted_at: nowUtc,
      source_device: sourceDevice,
      updated_at: nowUtc,
      version: { increment: 1 },
    },
  });
  // La baja no cabe en `CambioAcceso`, que solo contempla alta y edición: es
  // una tercera cosa y se dice como tal en vez de forzarla dentro.
  return { operation: "DELETE" as const, row };
}

/**
 * Retira la copia de solo lectura.
 *
 * Es el camino de vuelta que pide §9-bis: quien deja de pagar el plus pierde el
 * acceso, y **si la réplica solo supiera llegar, cada sede acabaría con el
 * padrón de la cadena entera**. Se marca borrada en vez de eliminarse, para que
 * el evento de baja viaje como cualquier otro y las dos bases converjan.
 */
export async function retirarVisitante(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  sourceDevice: string;
  nowUtc: Date;
}) {
  const { tx, sourceDevice, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();
  const previo = await tx.clienteVisitante.findUnique({ where: { ci } });
  if (!previo || previo.is_deleted) return null;
  const row = await tx.clienteVisitante.update({
    where: { ci },
    data: {
      is_deleted: true,
      deleted_at: nowUtc,
      source_device: sourceDevice,
      updated_at: nowUtc,
      version: { increment: 1 },
    },
  });
  return { operation: "DELETE", row };
}

/**
 * Barrido de caducidad: retira las copias cuyo plus ya no cubre
 * (docs/MULTI_SEDE.md §9-bis, «la caducidad del plus tiene que retirar la
 * réplica»).
 *
 * **Por qué esto sí se barre y la vigencia de una membresía no.** Es la
 * distinción de `MEMBRESIA_VENCIMIENTO_AUTOMATICO.md` §2: la verdad es
 * derivada y la copia va detrás. Quién puede entrar lo decide `accesoCubre`
 * contra la fecha, así que una copia rezagada **no miente ni deja pasar a
 * nadie**; solo ocupa sitio. Barrerla es limpieza de una proyección, no un
 * cambio de estado que nadie hizo. Por eso mismo este barrido **no toca**
 * `activo` del acceso: eso sí sería inventarse un acto.
 *
 * **Cada sede vence por su reloj.** La fecha de negocio se calcula con la zona
 * de la sede DUEÑA del socio, no con el día UTC ni con el de quien barre. Es el
 * aviso 1 de aquel documento, y el error que más veces ha vuelto en este
 * proyecto.
 *
 * **Solo escribe lo que cambia.** Un barrido que tocara todas las filas cada
 * noche generaría miles de eventos y ahogaría la cola, que ya se bloqueó dos
 * veces por acumulación.
 */
export async function barrerReplicasCaducadas(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  /** Calcula la fecha de negocio de una sede a partir de su zona horaria. */
  fechaNegocioDeSede: (timezone: string | null | undefined) => Date;
  sourceDevice: string;
  nowUtc: Date;
}) {
  const { tx, sourceDevice, nowUtc } = input;

  const copias = await tx.clienteVisitante.findMany({
    where: { is_deleted: false },
    select: { ci: true, gym_id_origen: true },
  });
  if (copias.length === 0) return { revisadas: 0, retiradas: [] as any[] };

  const accesos = await tx.clienteAccesoMultisede.findMany({
    where: { ci: { in: copias.map((c: any) => c.ci) } },
  });
  const accesoPorCi = new Map(accesos.map((a: any) => [a.ci, a]));

  // La zona de cada sede se lee una sola vez, no una por socio.
  const sedes = await tx.gym.findMany({
    where: { gym_id: { in: [...new Set(copias.map((c: any) => c.gym_id_origen))] } },
    select: { gym_id: true, timezone: true },
  });
  const zonaPorSede = new Map<string, string | null>(
    sedes.map((g: any) => [String(g.gym_id), g.timezone ?? null]),
  );

  const retiradas: any[] = [];
  for (const copia of copias) {
    const fechaNegocio = input.fechaNegocioDeSede(
      zonaPorSede.get(copia.gym_id_origen),
    );
    if (debeReplicarse(accesoPorCi.get(copia.ci) as any, fechaNegocio)) continue;
    retiradas.push(
      await tx.clienteVisitante.update({
        where: { ci: copia.ci },
        data: {
          is_deleted: true,
          deleted_at: nowUtc,
          source_device: sourceDevice,
          updated_at: nowUtc,
          version: { increment: 1 },
        },
      }),
    );
  }
  return { revisadas: copias.length, retiradas };
}

/**
 * Retira el acceso multi-sede.
 *
 * Apaga `activo` y **conserva la fila**. Borrarla perdería quién lo marcó y
 * hasta cuándo llegó a cubrir, que es justo lo que hay que poder mirar cuando
 * un socio reclama en otra sede que le dejaron fuera. La réplica de solo
 * lectura se retira igual, porque `debeReplicarse` mira `activo`.
 */
export async function retirarAccesoMultisede(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  sourceDevice: string;
  nowUtc: Date;
}) {
  const { tx, sourceDevice, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();
  const id = accesoMultisedeId(ci);
  const previo = await tx.clienteAccesoMultisede.findUnique({
    where: { cliente_acceso_multisede_id: id },
  });
  if (!previo || previo.is_deleted) {
    throw new AccesoMultisedeError(
      404,
      "ACCESO_MULTISEDE_NO_ENCONTRADO",
      "Ese socio no tiene acceso multi-sede que retirar.",
    );
  }
  const row = await tx.clienteAccesoMultisede.update({
    where: { cliente_acceso_multisede_id: id },
    data: {
      activo: false,
      source_device: sourceDevice,
      updated_at: nowUtc,
      version: { increment: 1 },
    },
  });
  return { operation: "UPDATE", row } as CambioAcceso<typeof row>;
}

/**
 * Cobra el plus multi-sede (M4b, docs/MULTI_SEDE.md §5.1).
 *
 * Hace tres cosas que **tienen que pasar juntas o no pasar**: extiende la
 * vigencia encadenando, registra el cobro con su periodo cubierto, y anota que
 * esta sede se quedó un dinero que es de la cadena. Separarlas dejaría el caso
 * que §7.10 llama el más caro: efectivo cobrado sin su deuda anotada, es decir,
 * margen de sede inflado con dinero ajeno.
 *
 * El movimiento de tesorería se inyecta porque el libro de caja **no es
 * gemelo** entre las dos APIs; el asiento del saldo sí lo es y por eso va
 * dentro, donde no se puede olvidar.
 *
 * `emitirEvento` es obligatorio por el mismo motivo de siempre: un dato sin su
 * rastro es una divergencia esperando turno.
 */
export async function cobrarAccesoMultisede(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  /** Sede que atiende el mostrador: en su caja entra el dinero. */
  gymIdQueCobra: string;
  cobradoPor: {
    userId: string;
    nombre: string;
    rol?: string | null;
    origen?: string | null;
  };
  tipoPagoId?: string | null;
  cuentaId?: string | null;
  fechaNegocio: Date;
  sourceDevice: string;
  nowUtc: Date;
  meses?: number;
  /** Identidad del cobro. La pone quien llama para poder ser determinista. */
  cobroId: string;
  /** Apunta el efectivo en el libro de caja de la sede que cobró. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registrarEnTesoreria: (cobro: any) => Promise<unknown>;
  /**
   * Encola el evento de una fila. Recibe la clave **explícita** y no la deduce
   * del payload: `acceso_multisede_cobro` tiene una columna
   * `cliente_acceso_multisede_id`, así que adivinarla con un `??` eligió la del
   * acceso en vez de la del cobro y el concentrador rechazó el evento con «PK
   * contradictoria», atascando la cola detrás. Lo destapó el cobro real del
   * 17-08-2026, no ninguna prueba.
   */
  emitirEvento: (
    entidad: string,
    operacion: string,
    entidadId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fila: any,
  ) => Promise<unknown>;
}) {
  const { tx, gymIdQueCobra, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();

  const socio = ci
    ? await tx.cliente.findFirst({
        where: { ci, is_deleted: false },
        select: { ci: true, gym_id: true },
      })
    : null;
  if (!socio) {
    throw new AccesoMultisedeError(
      404,
      "CLIENTE_NO_ENCONTRADO",
      "No existe un socio activo con esa identificación.",
    );
  }

  // Sin plus vigente, un socio de otra sede no puede pagar aquí (§5.4-bis).
  // Y cobrarle el plus a un socio ajeno es precisamente lo que no se puede
  // hacer sin haberlo comprobado: el plus lo vende su sede.
  const sedeDelSocio = String(socio.gym_id ?? "").trim();
  if (sedeDelSocio && sedeDelSocio !== gymIdQueCobra) {
    throw new AccesoMultisedeError(
      403,
      "PLUS_LO_VENDE_SU_SEDE",
      "El plus multi-sede lo vende la sede del socio, no la que visita.",
    );
  }

  const previo = await tx.clienteAccesoMultisede.findUnique({
    where: { cliente_acceso_multisede_id: accesoMultisedeId(ci) },
  });
  // El periodo cobrado empieza donde termina el que ya cubría; si no cubría
  // nada, empieza hoy. Es el mismo encadenado que aplica la vigencia, escrito
  // aquí para que el comprobante diga exactamente qué se compró.
  const cubriendo = previo && previo.activo && !previo.is_deleted
    ? new Date(previo.vigente_hasta)
    : null;
  const cubreDesde =
    cubriendo && cubriendo.getTime() > input.fechaNegocio.getTime()
      ? cubriendo
      : input.fechaNegocio;

  const acceso = await marcarAccesoMultisede({
    tx,
    ci,
    marcadoEnGymId: gymIdQueCobra,
    marcadoPorUserId: input.cobradoPor.userId,
    fechaNegocio: input.fechaNegocio,
    sourceDevice: input.sourceDevice,
    nowUtc,
    meses: input.meses,
  });
  await input.emitirEvento(
    "cliente_acceso_multisede",
    acceso.operation,
    acceso.row.cliente_acceso_multisede_id,
    acceso.row,
  );

  const cobro = await tx.accesoMultisedeCobro.create({
    data: {
      cobro_id: input.cobroId,
      ci,
      gym_id: gymIdQueCobra,
      cliente_acceso_multisede_id: acceso.row.cliente_acceso_multisede_id,
      importe: acceso.row.precio_snapshot,
      moneda_id: acceso.row.moneda_id,
      cubre_desde: cubreDesde,
      cubre_hasta: acceso.row.vigente_hasta,
      tipo_pago_id: input.tipoPagoId ?? null,
      cuenta_id: input.cuentaId ?? null,
      cobrado_por_user_id: input.cobradoPor.userId,
      cobrado_por_nombre_snapshot: input.cobradoPor.nombre,
      cobrado_por_rol_snapshot: input.cobradoPor.rol ?? null,
      cobrado_por_origen: input.cobradoPor.origen ?? null,
      fecha: nowUtc,
      source_device: input.sourceDevice,
      version: 1,
      is_deleted: false,
      created_at: nowUtc,
      updated_at: nowUtc,
      deleted_at: null,
    },
  });
  await input.emitirEvento(
    "acceso_multisede_cobro",
    "INSERT",
    cobro.cobro_id,
    cobro,
  );

  // El ingreso es de la cadena SIEMPRE, también cuando se cobra en la sede del
  // propio socio: por eso `decidirCobro` recibe las dos sedes iguales y aun así
  // devuelve saldo. Ver la prueba de paridad de la raíz.
  const decision = decidirCobro({
    clase: "PLUS_MULTISEDE",
    gymIdQueCobra,
    gymIdDelSocio: sedeDelSocio || gymIdQueCobra,
  });
  await anotarAsiento({
    tx,
    nowUtc,
    asiento: {
      asientoId: `sae-${input.cobroId}`,
      saldo: decision.saldo,
      monedaId: cobro.moneda_id,
      monto: normalizeMoney(cobro.importe),
      origenTipo: "COBRO_PLUS",
      origenId: cobro.cobro_id,
      claveOrigen: `COBRO_PLUS:${cobro.cobro_id}`,
      claseCobro: "PLUS_MULTISEDE",
      ci,
      ocurridoAt: nowUtc,
      fechaNegocio: input.fechaNegocio,
      sourceDevice: input.sourceDevice,
    },
    emitirEvento: (fila) =>
      input.emitirEvento("saldo_enlace_asiento", "INSERT", fila.asiento_id, fila),
  });

  await input.registrarEnTesoreria(cobro);

  return { acceso, cobro, decision, cubreDesde };
}


/**
 * Cobra el PLAN de un socio de otra sede (M4c, docs/MULTI_SEDE.md §5.3).
 *
 * Es el cobro cruzado: el socio paga donde entrena, el efectivo se queda en esa
 * caja y el ingreso es de su sede. Lo que aquí se decide con la cotización
 * replicada; lo que se escribe, con la mecánica de saldo de M4b.
 *
 * ## Lo que esta sede NO hace, y es deliberado
 *
 * **No toca la membresía del socio.** No la tiene: vive en su sede, que puede
 * estar sin conexión. §7.12 lo anticipa y resuelve el hueco por el lado del
 * mostrador —el socio queda habilitado aquí con su comprobante— en vez de
 * inventarse una membresía ajena que después habría que conciliar. Aplicar el
 * cobro a la cobertura le toca a quien tiene las dos partes delante.
 *
 * **No pone cuenta en el detalle.** Sería una caja de otra sede, y esa
 * referencia cruzada obligaría a abrir el aislamiento para las cuentas. Dónde
 * entró el efectivo lo dice el movimiento de tesorería de esta sede, que es
 * quien tiene que cuadrar su arqueo.
 */
export async function cobrarPlanDeVisitante(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  ci: string;
  /** Sede que atiende: en su caja entra el dinero. */
  gymIdQueCobra: string;
  cobradoPor: {
    userId: string;
    nombre: string;
    rol?: string | null;
    origen?: string | null;
  };
  /** El plus del socio, activo y cubriendo la fecha de negocio de hoy. */
  accesoMultisedeVigente: boolean;
  tipoPagoId?: string | null;
  /** Caja de ESTA sede donde entra el efectivo. */
  cuentaId?: string | null;
  fechaNegocio: Date;
  sourceDevice: string;
  nowUtc: Date;
  pagoId: string;
  detalleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registrarEnTesoreria: (pago: any) => Promise<unknown>;
  emitirEvento: (
    entidad: string,
    operacion: string,
    entidadId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fila: any,
  ) => Promise<unknown>;
}) {
  const { tx, gymIdQueCobra, nowUtc } = input;
  const ci = String(input.ci ?? "").trim();

  const fila = ci
    ? await tx.clienteVisitanteCotizacion.findFirst({
        where: { ci, is_deleted: false },
      })
    : null;

  const cotizacion: CotizacionDeVisita | null = fila
    ? {
        ci: fila.ci,
        gymIdOrigen: fila.gym_id_origen,
        planId: fila.plan_id,
        planCodigo: fila.plan_codigo,
        planNombre: fila.plan_nombre,
        monedaId: fila.moneda_id,
        precioLista: normalizeMoney(fila.precio_lista),
        precioFinal: normalizeMoney(fila.precio_final),
        categoriaCliente: fila.categoria_cliente,
        cubreHasta: fila.cubre_hasta ? new Date(fila.cubre_hasta) : null,
        mora: {
          activo: fila.mora_activo === true,
          modo: fila.mora_modo ?? null,
          valor: fila.mora_valor ?? null,
          tope: fila.mora_tope ?? null,
        },
        cuota:
          fila.cuota_numero == null
            ? null
            : {
                numero: Number(fila.cuota_numero),
                importe: normalizeMoney(fila.cuota_importe),
                fechaExigible: new Date(fila.cuota_fecha_exigible),
              },
        calculadaAl: new Date(fila.calculada_al),
      }
    : null;

  const decisionVisita = cotizarVisita({
    cotizacion,
    accesoMultisedeVigente: input.accesoMultisedeVigente,
    fechaNegocio: input.fechaNegocio,
  });
  if (decisionVisita.resultado === "BLOQUEADO") {
    throw new AccesoMultisedeError(
      409,
      "COBRO_CRUZADO_NO_DISPONIBLE",
      decisionVisita.motivo,
    );
  }
  const importe = decisionVisita.importe;
  const gymIdDelIngreso = cotizacion!.gymIdOrigen;

  // El detalle dice CÓMO se pagó, y eso no es opcional: `detalle_pago` lo
  // exige. La cuenta sí puede faltar —es de otra sede y va aparte—, pero el
  // método no; inventar uno metería en los informes de cobro un efectivo que
  // quizá fue tarjeta. Se pide y se dice por qué.
  if (!String(input.tipoPagoId ?? "").trim()) {
    throw new AccesoMultisedeError(
      400,
      "COBRO_CRUZADO_SIN_METODO",
      "Indique con qué método paga el visitante: el detalle del cobro no puede quedarse sin método.",
    );
  }

  // Cobrarle aquí a un socio de esta misma sede no es cobro cruzado: es el
  // cobro de siempre y tiene su propio camino, con sus reglas de membresía.
  if (gymIdDelIngreso === gymIdQueCobra) {
    throw new AccesoMultisedeError(
      409,
      "NO_ES_COBRO_CRUZADO",
      "El socio es de esta sede: su plan se cobra por el camino corriente.",
    );
  }

  // El ingreso es de SU sede; el efectivo, de esta. De ahí sale el saldo.
  const decision = decidirCobro({
    clase: "PLAN",
    gymIdQueCobra,
    gymIdDelSocio: gymIdDelIngreso,
  });

  const pago = await tx.pagoCliente.create({
    data: {
      pago_cliente_id: input.pagoId,
      ci,
      fecha: nowUtc,
      monto_total: importe.total,
      id_entrenador: null,
      id_planes_pago: cotizacion!.planId,
      moneda_id: importe.monedaId,
      precio_lista_snapshot: importe.precioLista,
      descuento_pct_snapshot: null,
      descuento_monto_snapshot: null,
      categoria_cliente_snapshot: importe.categoriaCliente,
      plan_codigo_snapshot: importe.planCodigo,
      cuota_sufijo_snapshot:
        importe.cuotaNumero == null ? null : String(importe.cuotaNumero),
      cobrado_por_user_id: input.cobradoPor.userId,
      cobrado_por_nombre_snapshot: input.cobradoPor.nombre,
      cobrado_por_rol_snapshot: input.cobradoPor.rol ?? null,
      cobrado_por_origen: input.cobradoPor.origen ?? null,
      // La sede DUEÑA del ingreso, y aparte dónde entró el efectivo.
      gym_id: gymIdDelIngreso,
      cobrado_en_gym_id: gymIdQueCobra,
      source_device: input.sourceDevice,
      version: 1,
      is_deleted: false,
      created_at: nowUtc,
      updated_at: nowUtc,
      deleted_at: null,
    },
  });
  await input.emitirEvento("pago_cliente", "INSERT", pago.pago_cliente_id, pago);

  const detalle = await tx.detallePago.create({
    data: {
      detalle_pago_id: input.detalleId,
      pago_cliente_id: pago.pago_cliente_id,
      tipo_pago_id: String(input.tipoPagoId).trim(),
      moneda_id: importe.monedaId,
      // Sin cuenta a propósito: la caja es de otra sede. Ver la política de
      // atribución.
      cuenta_id: null,
      cantidad: importe.total,
      tipo_cambio_id: null,
      // El detalle sigue al INGRESO: los informes de la sede dueña cruzan
      // pagos y detalles por el mismo `gym_id`.
      gym_id: gymIdDelIngreso,
      source_device: input.sourceDevice,
      version: 1,
      is_deleted: false,
      created_at: nowUtc,
      updated_at: nowUtc,
      deleted_at: null,
    },
  });
  await input.emitirEvento(
    "detalle_pago",
    "INSERT",
    detalle.detalle_pago_id,
    detalle,
  );

  await anotarAsiento({
    tx,
    nowUtc,
    asiento: {
      asientoId: `sae-${input.pagoId}`,
      saldo: decision.saldo,
      monedaId: importe.monedaId,
      monto: importe.total,
      origenTipo: "PAGO_CLIENTE",
      origenId: pago.pago_cliente_id,
      claveOrigen: `PAGO_CRUZADO:${pago.pago_cliente_id}`,
      claseCobro: "PLAN",
      ci,
      ocurridoAt: nowUtc,
      fechaNegocio: input.fechaNegocio,
      sourceDevice: input.sourceDevice,
    },
    emitirEvento: (f) =>
      input.emitirEvento("saldo_enlace_asiento", "INSERT", f.asiento_id, f),
  });

  await input.registrarEnTesoreria(pago);

  return { pago, detalle, importe, decision, cotizacion: cotizacion! };
}
