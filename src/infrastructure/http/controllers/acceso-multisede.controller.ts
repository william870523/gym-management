/**
 * M4a — productor HTTP del acceso multi-sede en el remoto.
 *
 * Dos recursos con dueños distintos, y conviene no mezclarlos:
 *
 * - **El precio** es de la cadena. Lo fija el Dueño de plataforma y ninguna
 *   sede lo toca (§9-bis). Su evento viaja con `gym_id: null` porque tiene que
 *   llegar a **todas** las instalaciones, igual que `gym`.
 * - **El acceso de un socio** lo marca recepción, en su propia sede. Su evento
 *   también viaja con `gym_id: null`: marcar a alguien como multi-sede replica
 *   su información a todas las sedes en la siguiente sincronización, sin
 *   esperar a que se presente en ninguna, porque ya compró el derecho a entrar
 *   en cualquiera (§9-bis, decisión del dueño del 27-07-2026).
 */
import type { Context } from "hono";
import { randomUUID } from "crypto";

import { prisma } from "../../db/prismaClient";
import { audienciasDelCobroPorCuentaAjena } from "../../../application/use-cases/sync/sync-event-contract";
import { trustedClock } from "../../../config/trusted-clock";
import { datePartsInZone } from "../../../config/tz";
import { env } from "../../../config/env";
import {
  AccesoMultisedeError,
  fijarPrecioGlobal,
  leerPrecioGlobal,
  marcarAccesoMultisede,
  proyectarVisitante,
  retirarAccesoMultisede,
  retirarVisitante,
} from "../../../application/acceso-multisede/acceso-multisede.service";
import {
  cobrarAccesoMultisede,
  cobrarPlanDeVisitante,
} from "../../../application/acceso-multisede/acceso-multisede.service";
import { cotizarVisita } from "../../../domain/cotizacion-visita-policy";
import { aplicarCobroCruzadoALaCobertura } from "../../../application/acceso-multisede/aplicar-cobro-cruzado";
import { TreasuryLedgerService } from "../../../application/accounting/treasury-ledger.service";
import { PrismaPaymentActorResolver } from "../../../application/payment/payment-actor";
import { accesoCubre } from "../../../domain/acceso-multisede-policy";
import { normalizeMoney } from "../../../domain/money";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

const DISPOSITIVO = "WEB_ADMIN";

const auth = (c: Context) => c.get("auth") as AuthTokenPayload | undefined;

/** Fecha de negocio de la sede, no la del servidor (docs/TIME_CONTRACT.md). */
async function fechaNegocio(tx: any, gymId: string) {
  const gym = await tx.gym.findUnique({
    where: { gym_id: gymId },
    select: { timezone: true },
  });
  const partes = datePartsInZone(
    gym?.timezone?.trim() || env.defaultGymTimezone,
    trustedClock.nowUtc(),
  );
  return new Date(Date.UTC(partes.year, partes.month - 1, partes.day));
}

const precioPublico = (fila: any) =>
  fila
    ? {
        acceso_multisede_precio_id: fila.acceso_multisede_precio_id,
        // `Decimal.toString()` se come los ceros de la derecha y devolvería
        // "150" donde el contrato exige "150.00". El adaptador de Flutter
        // acepta texto, pero texto CON su escala: es la frontera donde el
        // importe deja de ser exacto sin que nadie lo note.
        precio: normalizeMoney(fila.precio),
        moneda_id: fila.moneda_id,
        version: fila.version,
      }
    : null;

const accesoPublico = (fila: any, hoy: Date) =>
  fila
    ? {
        cliente_acceso_multisede_id: fila.cliente_acceso_multisede_id,
        ci: fila.ci,
        gym_id: fila.gym_id,
        activo: fila.activo,
        vigente_hasta: fila.vigente_hasta,
        vigente: accesoCubre(fila, hoy),
        // M4b — la fecha de negocio de la SEDE, publicada a propósito.
        //
        // La vista tiene que decir qué periodo va a comprar antes de cobrar, y
        // cuando el plus está caducado ese periodo empieza «hoy». Calculando
        // ese «hoy» en el navegador se equivocaba de día: el recorrido web del
        // 17-08-2026 prometió 17/08 → 17/09 y el servidor cobró 16/08 → 16/09,
        // porque el navegador miraba UTC y la sede vive en America/Los_Angeles.
        // Un día de diferencia en un comprobante de dinero no es un detalle.
        fecha_negocio: hoy,
        precio_snapshot: normalizeMoney(fila.precio_snapshot),
        moneda_id: fila.moneda_id,
        marcado_por_user_id: fila.marcado_por_user_id,
        marcado_en_gym_id: fila.marcado_en_gym_id,
        version: fila.version,
      }
    : null;

function responderError(c: Context, error: unknown) {
  if (error instanceof AccesoMultisedeError) {
    return c.json({ error: error.message, error_code: error.errorCode }, error.status as any);
  }
  const mensaje = error instanceof Error ? error.message : "Internal Server Error";
  return c.json({ error: mensaje }, 500);
}

/** Precio vigente del plus. Lo lee cualquier sede: necesita saber qué cobrar. */
export async function getPrecioAccesoMultisede(c: Context) {
  const fila = await leerPrecioGlobal(prisma);
  return c.json({ precio: precioPublico(fila) });
}

/**
 * Fija el precio global. Reservado al Dueño de la cadena: si cada sede pudiera
 * ponerlo, el plus dejaría de ser un ingreso de la cadena y volvería el
 * problema de §5.1 —margen inflado y consolidado contando dos veces—.
 */
export async function putPrecioAccesoMultisede(c: Context) {
  const sesion = auth(c);
  if (sesion?.esPlataforma !== true) {
    return c.json({
      error: "El precio del acceso multi-sede es del dueño de la cadena",
      error_code: "PLATFORM_AUTHORITY_REQUIRED",
    }, 403);
  }
  const body = await c.req.json().catch(() => null);
  try {
    const cambio = await prisma.$transaction(async (tx) => {
      const resultado = await fijarPrecioGlobal({
        tx,
        precio: body?.precio,
        monedaId: body?.moneda_id,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "acceso_multisede_precio",
          operacion: resultado.operation,
          entidad_id: resultado.row.acceso_multisede_precio_id,
          // Global: el precio del plus rige en toda la cadena.
          gym_id: null,
          payload_json: JSON.stringify(resultado.row),
        },
      });
      return resultado;
    });
    return c.json({ precio: precioPublico(cambio.row) });
  } catch (error) {
    return responderError(c, error);
  }
}

/** Acceso multi-sede de un socio, con su vigencia ya derivada. */
export async function getAccesoMultisedeCliente(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId) return c.json({ error: "La sesión no identifica gimnasio." }, 403);
  const ci = c.req.param("ci").trim();
  const fila = await prisma.clienteAccesoMultisede.findFirst({
    where: { ci, is_deleted: false },
  });
  const hoy = await fechaNegocio(prisma, sesion.gymId);
  return c.json({ acceso: accesoPublico(fila, hoy) });
}


/**
 * Socios de OTRAS sedes que la sede activa puede atender. Gemelo del local.
 *
 * Nace del recorrido del 16-08: el mostrador buscaba solo en el padrón de la
 * sede y por eso no encontraba a ningún visitante, sin error y sin entrada.
 * Devuelve también a quien tiene el plus vencido, marcado, para que el
 * mostrador pueda decir por qué en vez de no encontrar a nadie.
 */
export async function listarVisitantes(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId) return c.json({ error: "La sesión no identifica gimnasio." }, 403);
  const hoy = await fechaNegocio(prisma, sesion.gymId);
  const copias = await prisma.clienteVisitante.findMany({
    where: { is_deleted: false, gym_id_origen: { not: sesion.gymId } },
    orderBy: [{ apellidos: "asc" }, { nombres: "asc" }],
  });
  if (copias.length === 0) return c.json({ visitantes: [] });

  const accesos = await prisma.clienteAccesoMultisede.findMany({
    where: { ci: { in: copias.map((copia) => copia.ci) }, is_deleted: false },
  });
  const accesoPorCi = new Map(accesos.map((acceso) => [acceso.ci, acceso]));

  return c.json({
    visitantes: copias.map((copia) => ({
      ci: copia.ci,
      nombres: copia.nombres,
      apellidos: copia.apellidos,
      gym_id_origen: copia.gym_id_origen,
      membresia_estado: copia.membresia_estado,
      membresia_fecha_fin: copia.membresia_fecha_fin,
      acceso_vigente: accesoCubre(accesoPorCi.get(copia.ci) as any, hoy),
    })),
  });
}

/**
 * Marca o renueva el acceso multi-sede de un socio.
 *
 * **Acotado a los socios de la sede activa**, salvo para el Dueño. Vender el
 * plus a un socio ajeno es parte del cobro cruzado (§5.3), que es M4b y trae
 * consigo el saldo entre sedes; permitirlo aquí registraría el ingreso en la
 * sede equivocada, que es el riesgo contable más caro que nombra §7.10.
 */
export async function postAccesoMultisedeCliente(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId || !sesion.sub) {
    return c.json({ error: "La sesión no identifica gimnasio y operador." }, 403);
  }
  const ci = c.req.param("ci").trim();
  try {
    const cambio = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.findFirst({
        where: { ci, is_deleted: false },
        select: { gym_id: true },
      });
      if (!cliente) {
        throw new AccesoMultisedeError(
          404,
          "CLIENTE_NO_ENCONTRADO",
          "No existe un socio activo con esa identificación.",
        );
      }
      if (
        sesion.esPlataforma !== true &&
        (cliente.gym_id ?? sesion.gymId) !== sesion.gymId
      ) {
        throw new AccesoMultisedeError(
          403,
          "CLIENTE_DE_OTRA_SEDE",
          "El socio pertenece a otra sede. El cobro por cuenta ajena todavía no está habilitado.",
        );
      }

      const resultado = await marcarAccesoMultisede({
        tx,
        ci,
        marcadoEnGymId: sesion.gymId!,
        marcadoPorUserId: sesion.sub,
        fechaNegocio: await fechaNegocio(tx, sesion.gymId!),
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });

      // La persona antes que su permiso: quien reciba los dos eventos en orden
      // tiene a quién buscar antes de saber que puede dejarle entrar.
      const visitante = await proyectarVisitante({
        tx,
        ci,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "cliente_visitante",
          operacion: visitante.operation,
          entidad_id: visitante.row.ci,
          gym_id: null,
          payload_json: JSON.stringify(visitante.row),
        },
      });

      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "cliente_acceso_multisede",
          operacion: resultado.operation,
          entidad_id: resultado.row.cliente_acceso_multisede_id,
          // Global: la marca tiene que llegar a TODAS las sedes, no solo a la
          // del socio, o la sede visitada no sabría que puede dejarle entrar.
          gym_id: null,
          payload_json: JSON.stringify(resultado.row),
        },
      });
      return resultado;
    });
    const hoy = await fechaNegocio(prisma, sesion.gymId);
    return c.json({ acceso: accesoPublico(cambio.row, hoy) }, cambio.operation === "INSERT" ? 201 : 200);
  } catch (error) {
    return responderError(c, error);
  }
}

/**
 * Cobra el plus multi-sede: extiende la vigencia y toma el dinero.
 *
 * Está separado de `POST /clientes/:ci` a propósito. Aquel marca sin cobrar
 * —es lo que M4a entregó, y sigue sirviendo para una corrección o una
 * cortesía—; este es la venta. Mezclarlos habría dejado un solo endpoint que a
 * veces mueve dinero y a veces no, según lo que traiga el cuerpo.
 */
export async function postCobroAccesoMultisede(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId || !sesion.sub) {
    return c.json({ error: "La sesión no identifica gimnasio y operador." }, 403);
  }
  const ci = c.req.param("ci").trim();
  const cuerpo = await c.req.json().catch(() => ({}) as any);
  try {
    // R5.6 — quién recibe el dinero se revalida contra la base antes de tocar
    // nada, y falla cerrado: sin actor válido no hay cobro.
    const actor = await new PrismaPaymentActorResolver(prisma).resolve({
      userId: sesion.sub,
      gymId: sesion.gymId,
    });
    const ledger = new TreasuryLedgerService();
    const nowUtc = trustedClock.nowUtc();
    const cobroId = randomUUID();

    const resultado = await prisma.$transaction(async (tx) => {
      const salida = await cobrarAccesoMultisede({
        tx,
        ci,
        gymIdQueCobra: sesion.gymId!,
        cobradoPor: {
          userId: actor.userId,
          nombre: actor.nombre,
          rol: actor.rol,
          origen: actor.origen,
        },
        tipoPagoId: cuerpo?.tipo_pago_id ?? null,
        cuentaId: cuerpo?.cuenta_id ?? null,
        fechaNegocio: await fechaNegocio(tx, sesion.gymId!),
        sourceDevice: DISPOSITIVO,
        nowUtc,
        cobroId,
        registrarEnTesoreria: (cobro) =>
          ledger.recordPlusMultisedeInTx(tx, sesion.gymId!, cobro),
        emitirEvento: (entidad, operacion, entidadId, fila) =>
          tx.syncLog.create({
            data: {
              event_id: randomUUID(),
              entidad,
              operacion,
              entidad_id: entidadId,
              // La marca tiene que llegar a TODAS las sedes; el cobro y su
              // asiento son de la sede que cobró y viajan como suyos.
              gym_id: entidad === "cliente_acceso_multisede" ? null : sesion.gymId!,
              device_id: null,
              payload_json: JSON.stringify(fila),
            },
          }),
      });

      // La persona antes que su permiso, igual que al marcar.
      const visitante = await proyectarVisitante({
        tx,
        ci,
        sourceDevice: DISPOSITIVO,
        nowUtc,
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "cliente_visitante",
          operacion: visitante.operation,
          entidad_id: visitante.row.ci,
          gym_id: null,
          payload_json: JSON.stringify(visitante.row),
        },
      });
      return salida;
    });

    const hoy = await fechaNegocio(prisma, sesion.gymId);
    return c.json(
      {
        acceso: accesoPublico(resultado.acceso.row, hoy),
        cobro: {
          cobro_id: resultado.cobro.cobro_id,
          ci: resultado.cobro.ci,
          importe: normalizeMoney(resultado.cobro.importe),
          moneda_id: resultado.cobro.moneda_id,
          cubre_desde: resultado.cobro.cubre_desde,
          cubre_hasta: resultado.cobro.cubre_hasta,
          cobrado_en_gym_id: resultado.cobro.gym_id,
          ingreso_de: "CADENA",
        },
      },
      201,
    );
  } catch (error) {
    return responderError(c, error);
  }
}

/** Lee la cotización tal y como está replicada, sin decidir nada todavía. */
async function cotizacionDeVisita(tx: any, ci: string) {
  const fila = await tx.clienteVisitanteCotizacion.findFirst({
    where: { ci, is_deleted: false },
  });
  if (!fila) return null;
  return {
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
  };
}

/** ¿El plus de este socio cubre hoy en esta sede? */
async function plusVigente(tx: any, ci: string, hoy: Date) {
  const acceso = await tx.clienteAccesoMultisede.findFirst({
    where: { ci, is_deleted: false },
  });
  return accesoCubre(acceso as any, hoy);
}

/**
 * Qué se le cobraría hoy a un visitante, sin cobrar nada (M4c).
 *
 * El mostrador lo necesita **antes** de pulsar: enseñar un importe después de
 * haberlo cobrado no sirve para decidir. Y como el recargo por mora se
 * recalcula al leer, este endpoint devuelve el importe de hoy, no el de la foto.
 */
export async function getCotizacionDeVisitante(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId) return c.json({ error: "La sesión no identifica gimnasio." }, 403);
  const ci = c.req.param("ci").trim();
  const hoy = await fechaNegocio(prisma, sesion.gymId);
  const cotizacion = await cotizacionDeVisita(prisma, ci);
  const decision = cotizarVisita({
    cotizacion,
    accesoMultisedeVigente: await plusVigente(prisma, ci, hoy),
    fechaNegocio: hoy,
  });

  if (decision.resultado === "BLOQUEADO") {
    // 200 y no 409: preguntar qué se le cobraría a alguien a quien no se le
    // puede cobrar es una pregunta legítima, y el mostrador necesita el motivo
    // para decirlo en pantalla en vez de enseñar un error.
    return c.json({ cobrable: false, motivo: decision.motivo });
  }
  const i = decision.importe;
  return c.json({
    cobrable: true,
    cotizacion: {
      ci,
      gym_id_origen: cotizacion!.gymIdOrigen,
      plan_codigo: i.planCodigo,
      plan_nombre: cotizacion!.planNombre,
      moneda_id: i.monedaId,
      precio_lista: i.precioLista,
      base: i.base,
      recargo_mora: i.recargoMora,
      total: i.total,
      dias_atraso: i.diasAtraso,
      cuota_numero: i.cuotaNumero,
      categoria_cliente: i.categoriaCliente,
      // La antigüedad de la foto se publica: el operador tiene derecho a saber
      // de cuándo es el precio que está a punto de cobrar.
      antiguedad_dias: i.antiguedadDias,
    },
  });
}

/**
 * Cobra el plan de un visitante (M4c): el efectivo se queda aquí y el ingreso
 * es de su sede.
 */
export async function postCobroCruzado(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId || !sesion.sub) {
    return c.json({ error: "La sesión no identifica gimnasio y operador." }, 403);
  }
  const ci = c.req.param("ci").trim();
  const cuerpo = await c.req.json().catch(() => ({}) as any);
  try {
    const actor = await new PrismaPaymentActorResolver(prisma).resolve({
      userId: sesion.sub,
      gymId: sesion.gymId,
    });
    const ledger = new TreasuryLedgerService();
    const nowUtc = trustedClock.nowUtc();
    const pagoId = randomUUID();
    const cuentaId = cuerpo?.cuenta_id ?? null;

    const resultado = await prisma.$transaction(async (tx) => {
      const hoy = await fechaNegocio(tx, sesion.gymId!);
      const cobro = await cobrarPlanDeVisitante({
        tx,
        ci,
        gymIdQueCobra: sesion.gymId!,
        cobradoPor: {
          userId: actor.userId,
          nombre: actor.nombre,
          rol: actor.rol,
          origen: actor.origen,
        },
        accesoMultisedeVigente: await plusVigente(tx, ci, hoy),
        tipoPagoId: cuerpo?.tipo_pago_id ?? null,
        cuentaId,
        fechaNegocio: hoy,
        sourceDevice: DISPOSITIVO,
        nowUtc,
        pagoId,
        detalleId: randomUUID(),
        registrarEnTesoreria: (pago) =>
          ledger.recordCobroCruzadoInTx(tx, sesion.gymId!, pago, cuentaId),
        // M4c — el pago y su detalle interesan a DOS sedes: la dueña del
        // ingreso y la que se quedó el efectivo. Se anuncian a las dos, con un
        // evento por destinatario, porque cada instalación descarga por su
        // `gym_id` y lleva su propio cursor. El asiento del saldo y el
        // movimiento de caja son solo de quien cobró y viajan como suyos.
        //
        // Antes esto emitía un único evento hacia la sede dueña, así que la
        // sede que tenía el dinero se quedaba con el asiento y el movimiento
        // colgando de un pago que en su base no existía.
        emitirEvento: async (entidad, operacion, entidadId, fila) => {
          const destinatarios =
            audienciasDelCobroPorCuentaAjena({
              entity: entidad,
              payload: fila as Record<string, unknown>,
              gymIdEmisor: sesion.gymId!,
            }) ??
            (entidad === "saldo_enlace_asiento"
              ? [sesion.gymId!]
              : [String(fila.gym_id ?? sesion.gymId)]);
          for (const destinatario of destinatarios) {
            await tx.syncLog.create({
              data: {
                event_id: randomUUID(),
                entidad,
                operacion,
                entidad_id: entidadId,
                gym_id: destinatario,
                device_id: null,
                payload_json: JSON.stringify(fila),
              },
            });
          }
        },
      });

      // Un cobro hecho AQUÍ no sube: ya está en el concentrador. Si la
      // cobertura solo se aplicara al subir, el visitante atendido desde la web
      // pagaría y seguiría figurando vencido en su sede para siempre. Lo
      // destapó la sonda del 17-08. Llamarlo en los dos sitios es seguro porque
      // el aplicador es idempotente por `pago_membresia_aplicacion`: esa
      // idempotencia deja de ser una precaución y pasa a ser lo que sostiene
      // que haya dos caminos.
      await aplicarCobroCruzadoALaCobertura({
        tx,
        pago: cobro.pago,
        fechaNegocio: await fechaNegocio(tx, String(cobro.pago.gym_id)),
        nowUtc,
        sourceDevice: DISPOSITIVO,
        emitirEvento: (entidad, operacion, entidadId, fila) =>
          tx.syncLog.create({
            data: {
              event_id: randomUUID(),
              entidad,
              operacion,
              entidad_id: entidadId,
              gym_id: String(cobro.pago.gym_id),
              device_id: null,
              payload_json: JSON.stringify(fila),
            },
          }),
      });
      return cobro;
    });

    return c.json(
      {
        cobro: {
          pago_cliente_id: resultado.pago.pago_cliente_id,
          ci: resultado.pago.ci,
          total: normalizeMoney(resultado.pago.monto_total),
          base: resultado.importe.base,
          recargo_mora: resultado.importe.recargoMora,
          dias_atraso: resultado.importe.diasAtraso,
          moneda_id: resultado.pago.moneda_id,
          ingreso_de: resultado.pago.gym_id,
          cobrado_en_gym_id: resultado.pago.cobrado_en_gym_id,
          plan_codigo: resultado.importe.planCodigo,
          cuota_numero: resultado.importe.cuotaNumero,
        },
      },
      201,
    );
  } catch (error) {
    return responderError(c, error);
  }
}

/** Retira el acceso. Conserva la fila: su historia es lo que se consulta cuando
 * un socio reclama que le dejaron fuera en otra sede. */
export async function deleteAccesoMultisedeCliente(c: Context) {
  const sesion = auth(c);
  if (!sesion?.gymId) return c.json({ error: "La sesión no identifica gimnasio." }, 403);
  const ci = c.req.param("ci").trim();
  try {
    const cambio = await prisma.$transaction(async (tx) => {
      // El mismo guarda que el alta: sin él, recepción de una sede podía
      // cancelarle el plus a un socio ajeno aunque venderlo estuviera
      // prohibido. Lo destapó la sonda de elegibilidad del 16-08.
      const cliente = await tx.cliente.findFirst({
        where: { ci, is_deleted: false },
        select: { gym_id: true },
      });
      if (
        cliente &&
        sesion.esPlataforma !== true &&
        (cliente.gym_id ?? sesion.gymId) !== sesion.gymId
      ) {
        throw new AccesoMultisedeError(
          403,
          "CLIENTE_DE_OTRA_SEDE",
          "El socio pertenece a otra sede: su acceso multi-sede se administra allí.",
        );
      }
      const resultado = await retirarAccesoMultisede({
        tx,
        ci,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      await tx.syncLog.create({
        data: {
          event_id: randomUUID(),
          entidad: "cliente_acceso_multisede",
          operacion: "UPDATE",
          entidad_id: resultado.row.cliente_acceso_multisede_id,
          gym_id: null,
          payload_json: JSON.stringify(resultado.row),
        },
      });

      // El camino de vuelta: sin esto, la copia se quedaría en todas las sedes
      // para siempre y el padrón de cada una acabaría siendo el de la cadena.
      const visitante = await retirarVisitante({
        tx,
        ci,
        sourceDevice: DISPOSITIVO,
        nowUtc: trustedClock.nowUtc(),
      });
      if (visitante) {
        await tx.syncLog.create({
          data: {
            event_id: randomUUID(),
            entidad: "cliente_visitante",
            operacion: "DELETE",
            entidad_id: visitante.row.ci,
            gym_id: null,
            payload_json: JSON.stringify(visitante.row),
          },
        });
      }
      return resultado;
    });
    const hoy = await fechaNegocio(prisma, sesion.gymId);
    return c.json({ acceso: accesoPublico(cambio.row, hoy) });
  } catch (error) {
    return responderError(c, error);
  }
}
