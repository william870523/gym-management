/**
 * Aplica un cobro cruzado a la cobertura del socio, en su sede (M4c,
 * docs/MULTI_SEDE.md §5.3, §5.4-ter y §7.12).
 *
 * ## Por qué esto vive en el concentrador y no en la sede que cobró
 *
 * La sede visitada **no puede** hacerlo: no tiene la membresía del socio, que
 * vive en su sede y puede estar sin conexión. §7.12 lo dice: «el pago existe en
 * B y viaja cuando A sincronice; la membresía de A no se actualiza hasta
 * entonces». Ese hueco se cubre en el mostrador —el socio entra con su
 * comprobante— pero alguien tiene que cerrarlo después.
 *
 * Y no puede cerrarlo la sede dueña al bajar el pago, porque entonces la
 * cobertura solo avanzaría cuando esa instalación se conectara: un socio que
 * pagó el martes en otra sede seguiría figurando vencido en la suya hasta que
 * alguien encendiera su escritorio. El concentrador es el único sitio con las
 * dos partes delante **siempre**.
 *
 * Se llama desde **dos** caminos —la subida de la cola y el cobro hecho
 * directamente contra el remoto—, porque un cobro hecho en la web no sube: ya
 * está aquí. Que eso sea seguro es exactamente lo que compra la idempotencia.
 *
 * ## Qué aplica, y con qué reglas
 *
 * Las mismas que el cobro corriente, reusadas y no reescritas:
 *
 * - **Por cuotas**, marca pagada la cuota que el cobro trae, con
 *   `PlanInstallmentService`, que además distingue `PAGADA` de `ANTICIPADA`.
 * - **Por periodo**, extiende con `resolveServicePeriod`, la misma función de
 *   dominio que usa el cobro de la propia sede: renovar antes de tiempo
 *   encadena desde el fin vigente, no desde hoy.
 *
 * Duplicar aquí esas reglas habría sido la manera segura de que, dentro de tres
 * meses, un socio renovara distinto según dónde pagara.
 *
 * ## Cobrar dos veces no es un conflicto (§5.4-ter)
 *
 * Decisión del dueño: «si pagó este mes en Centro y volvió a pagar en Oeste, el
 * de Oeste sería el mes siguiente». Sin conexión no se puede impedir que dos
 * sedes cobren lo mismo, y hacerle esperar al socio para averiguarlo tampoco es
 * una solución. Lo que sí se puede es que salga **barato**: el dinero se aplica
 * como adelanto y queda un aviso en la bandeja de su sede para que alguien
 * decida si procede devolverlo.
 *
 * ## Es idempotente, y el rastro no se inventa
 *
 * La cola reintenta. Aplicar dos veces el mismo cobro regalaría un mes.
 * `pago_membresia_aplicacion` —la tabla que el cobro corriente ya usa para
 * anotar qué pago fue a qué membresía— lo resuelve: su `unique(pago, membresía)`
 * convierte el segundo intento en un no-op. Y es también lo que distingue un
 * **reintento** de un **doble cobro**: el reintento ya tiene su asiento; el
 * doble cobro no.
 */
import { randomUUID } from "crypto";
import { resolveServicePeriod } from "../../domain/membership-policy";
import { PlanInstallmentService } from "../membership/plan-installment.service";
import { decimalToUnits, unitsToDecimal } from "../../domain/money";

/** Tipo del aviso, para que la bandeja pueda filtrarlo por su nombre. */
export const AVISO_PAGO_ADELANTADO = "COBRO_CRUZADO_ADELANTADO";

export type ResultadoDeAplicacion =
  | { readonly aplicado: false; readonly motivo: string }
  | {
      readonly aplicado: true;
      readonly modo: "CUOTA" | "PERIODO";
      readonly membresiaId: string;
      readonly cubreHasta: Date;
      /** El socio ya estaba cubierto: este cobro compró el periodo siguiente. */
      readonly adelantado: boolean;
    };

const texto = (valor: unknown) => String(valor ?? "").trim();

/**
 * Dónde se cobró, dicho de manera que la frase funcione también sin el dato.
 *
 * Antes se interpolaba `… || "otra"` dentro de «en la sede X», y cuando faltaba
 * el dato el aviso decía «en la sede otra». Lo leyó el recorrido del
 * 17-08-2026, y el hueco era real: el cobro que subía por la cola llegaba sin
 * `cobrado_en_gym_id` porque el repositorio no lo escribía. Aquel defecto está
 * corregido; este texto se queda porque un aviso al dueño no puede depender de
 * que ningún campo falte nunca.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dondeSeCobro(pago: any): string {
  const sede = texto(pago?.cobrado_en_gym_id);
  return sede ? `en la sede ${sede}` : "en otra sede";
}

export async function aplicarCobroCruzadoALaCobertura(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  /** El cobro tal y como quedó guardado, ya con su `gym_id` de la sede dueña. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pago: any;
  /** Fecha de negocio de la SEDE DUEÑA: su cobertura, su calendario. */
  fechaNegocio: Date;
  nowUtc: Date;
  sourceDevice: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitirEvento: (entidad: string, operacion: string, entidadId: string, fila: any) => Promise<unknown>;
}): Promise<ResultadoDeAplicacion> {
  const { tx, pago, nowUtc } = input;
  const gymId = texto(pago?.gym_id);
  const ci = texto(pago?.ci);
  if (!gymId || !ci) {
    return { aplicado: false, motivo: "El cobro no identifica sede ni socio." };
  }

  const membresia = await tx.membresiaCliente.findFirst({
    where: {
      ci,
      gym_id: gymId,
      is_deleted: false,
      estado: { in: ["ACTIVA", "PENDIENTE_PAGO"] },
    },
    orderBy: { fecha_fin: "desc" },
  });
  if (!membresia) {
    // No es una avería: el socio pudo darse de baja en su sede entre que se
    // replicó su cotización y llegó el cobro. El dinero está registrado y su
    // sede decidirá; inventarle una membresía sería peor.
    return { aplicado: false, motivo: "El socio no tiene membresía viva en su sede." };
  }

  // El asiento de aplicación es lo que hace idempotente este camino, y lo que
  // distingue un reintento de la cola de un doble cobro de verdad.
  const yaAplicado = await tx.pagoMembresiaAplicacion.findFirst({
    where: {
      pago_cliente_id: texto(pago.pago_cliente_id),
      membresia_id: membresia.membresia_id,
      is_deleted: false,
    },
    select: { aplicacion_id: true },
  });
  if (yaAplicado) {
    return { aplicado: false, motivo: "El cobro ya se había aplicado a esta membresía." };
  }

  const numeroCuota = Number(texto(pago.cuota_sufijo_snapshot));
  if (Number.isSafeInteger(numeroCuota) && numeroCuota > 0) {
    const cuota = await tx.membresiaCuota.findFirst({
      where: {
        membresia_id: membresia.membresia_id,
        gym_id: gymId,
        numero_cuota: numeroCuota,
        is_deleted: false,
      },
    });
    if (!cuota) {
      return { aplicado: false, motivo: "La cuota cobrada ya no existe en su sede." };
    }

    // La cuota que el cobro nombra ya estaba pagada: es el doble cobro de
    // §5.4-ter. No se rechaza —el dinero entró— sino que se adelanta a la
    // siguiente pendiente, que es lo que el dueño decidió.
    let numeroAplicable = numeroCuota;
    let adelanto = false;
    if (cuota.estado === "PAGADA" || cuota.estado === "ANTICIPADA") {
      const siguiente = await tx.membresiaCuota.findFirst({
        where: {
          membresia_id: membresia.membresia_id,
          gym_id: gymId,
          is_deleted: false,
          estado: "PENDIENTE",
        },
        orderBy: { numero_cuota: "asc" },
        select: { numero_cuota: true },
      });
      if (!siguiente) {
        // Pagó de más y no queda cuota que adelantar. No se inventa una: el
        // dinero está registrado y su sede decide si lo devuelve.
        return {
          aplicado: false,
          motivo: "Todas las cuotas estaban pagadas: el cobro queda sin aplicar.",
        };
      }
      numeroAplicable = Number(siguiente.numero_cuota);
      adelanto = true;
    }

    const actualizada = await new PlanInstallmentService().payInstallment(tx, {
      gymId,
      membershipId: membresia.membresia_id,
      numeroCuota: numeroAplicable,
      pagoDetalleId: texto(pago.pago_cliente_id),
      nowUtc,
    });

    await anotarAplicacion({
      tx,
      pago,
      gymId,
      membresiaId: membresia.membresia_id,
      nowUtc,
      sourceDevice: input.sourceDevice,
      emitirEvento: input.emitirEvento,
    });

    if (adelanto) {
      await avisarDePagoAdelantado({
        tx,
        gymId,
        pago,
        membresiaId: membresia.membresia_id,
        nowUtc,
        sourceDevice: input.sourceDevice,
        emitirEvento: input.emitirEvento,
        mensaje:
          `El socio ${ci} pagó la cuota ${numeroCuota} estando ya pagada, ` +
          `${dondeSeCobro(pago)}. Se aplicó a la cuota ` +
          `${numeroAplicable} como adelanto. Revísenlo por si procede devolverlo.`,
      });
    }

    return {
      aplicado: true,
      modo: "CUOTA",
      membresiaId: membresia.membresia_id,
      cubreHasta: new Date(actualizada?.fecha_cobertura_fin ?? membresia.fecha_fin),
      adelantado: adelanto,
    };
  }

  // Periodo: se encadena con la misma función que el cobro de la propia sede.
  const periodo = resolveServicePeriod({
    plannedStart: membresia.fecha_inicio,
    activeMembershipEnd: membresia.fecha_fin,
    businessToday: input.fechaNegocio,
    durationDays: Number(membresia.duracion_dias_snapshot),
  });

  // Si el periodo comprado empieza en el futuro, el socio ya estaba cubierto:
  // esto no es su renovación, es un mes de más.
  const adelantado = periodo.start.getTime() > input.fechaNegocio.getTime();

  const pagado =
    decimalToUnits(membresia.importe_pagado ?? "0") +
    decimalToUnits(pago.monto_total ?? "0");

  const fila = await tx.membresiaCliente.update({
    where: { membresia_id: membresia.membresia_id },
    data: {
      fecha_inicio: periodo.start,
      fecha_fin: periodo.endExclusive,
      estado: "ACTIVA",
      importe_pagado: unitsToDecimal(pagado),
      source_device: input.sourceDevice,
      updated_at: nowUtc,
      version: { increment: 1 },
    },
  });
  await input.emitirEvento("membresia_cliente", "UPDATE", fila.membresia_id, fila);

  await anotarAplicacion({
    tx,
    pago,
    gymId,
    membresiaId: fila.membresia_id,
    nowUtc,
    sourceDevice: input.sourceDevice,
    emitirEvento: input.emitirEvento,
  });

  if (adelantado) {
    await avisarDePagoAdelantado({
      tx,
      gymId,
      pago,
      membresiaId: fila.membresia_id,
      nowUtc,
      sourceDevice: input.sourceDevice,
      emitirEvento: input.emitirEvento,
      mensaje:
        `El socio ${ci} ya estaba cubierto y volvió a pagar ${dondeSeCobro(pago)}. ` +
        `Se aplicó al periodo siguiente, ` +
        `hasta el ${new Date(fila.fecha_fin).toISOString().slice(0, 10)}. ` +
        `Revísenlo por si procede devolverlo.`,
    });
  }

  return {
    aplicado: true,
    modo: "PERIODO",
    membresiaId: fila.membresia_id,
    cubreHasta: new Date(fila.fecha_fin),
    adelantado,
  };
}

/** El asiento que hace idempotente la aplicación. */
async function anotarAplicacion(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pago: any;
  gymId: string;
  membresiaId: string;
  nowUtc: Date;
  sourceDevice: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitirEvento: (entidad: string, operacion: string, entidadId: string, fila: any) => Promise<unknown>;
}) {
  const aplicacion = await input.tx.pagoMembresiaAplicacion.create({
    data: {
      aplicacion_id: `pma-${texto(input.pago.pago_cliente_id)}`,
      pago_cliente_id: texto(input.pago.pago_cliente_id),
      membresia_id: input.membresiaId,
      moneda_id: texto(input.pago.moneda_id),
      monto_aplicado: String(input.pago.monto_total),
      gym_id: input.gymId,
      source_device: input.sourceDevice,
      version: 1,
      is_deleted: false,
      created_at: input.nowUtc,
      updated_at: input.nowUtc,
      deleted_at: null,
    },
  });
  await input.emitirEvento(
    "pago_membresia_aplicacion",
    "INSERT",
    aplicacion.aplicacion_id,
    aplicacion,
  );
  return aplicacion;
}

/**
 * Deja el aviso en la bandeja de la sede DUEÑA (§5.4-ter).
 *
 * El aviso, y no el bloqueo. Va a la sede dueña porque es la que tiene el
 * historial del socio delante y la que va a atender su reclamación.
 */
async function avisarDePagoAdelantado(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  gymId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pago: any;
  membresiaId: string;
  mensaje: string;
  nowUtc: Date;
  sourceDevice: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitirEvento: (entidad: string, operacion: string, entidadId: string, fila: any) => Promise<unknown>;
}) {
  const aviso = await input.tx.avisoAdministracion.create({
    data: {
      aviso_id: randomUUID(),
      gym_id: input.gymId,
      tipo: AVISO_PAGO_ADELANTADO,
      referencia_id: input.membresiaId,
      mensaje: input.mensaje,
      actor_user_id: input.pago.cobrado_por_user_id ?? null,
      actor_nombre: input.pago.cobrado_por_nombre_snapshot ?? null,
      leido: false,
      is_deleted: false,
      created_at: input.nowUtc,
      source_device: input.sourceDevice,
      version: 1,
      updated_at: input.nowUtc,
      deleted_at: null,
    },
  });
  await input.emitirEvento("aviso_administracion", "INSERT", aviso.aviso_id, aviso);
  return aviso;
}
