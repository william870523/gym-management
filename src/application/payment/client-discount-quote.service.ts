import {
  discountBreakdown,
  parseClientCategory,
} from "../../domain/client-discount-policy";
import {
  CLIENT_OLD_DISCOUNT_KEY,
  resolveClientDiscountPct,
} from "../../domain/clients/client-discount-settings";
import { prisma } from "../../infrastructure/db/prismaClient";

export interface ClientDiscountQuote {
  precio_lista: string;
  descuento_pct: string | null;
  descuento: string;
  precio_final: string;
  motivo: "SIN_DESCUENTO" | "PORCENTAJE_GLOBAL" | "EXCEPCION_FIJA";
  categoria_cliente: "NUEVO" | "VIEJO";
  plan_codigo: string;
  plan_nombre: string;
  cuota_sufijo: string | null;
}

export async function resolveClientDiscountQuote(
  tx: any,
  input: { gymId: string; ci: string; planId: string; numeroCuota?: number | null },
): Promise<ClientDiscountQuote> {
  const [client, plan, settings] = await Promise.all([
    tx.cliente.findFirst({
      where: { ci: input.ci, gym_id: input.gymId, is_deleted: false },
      select: { categoria: true },
    }),
    tx.planesPago.findFirst({
      where: { id_planes_pago: input.planId, gym_id: input.gymId, is_deleted: false },
      select: {
        importe_plan_pago: true,
        precio_viejo_excepcion: true,
        codigo: true,
        nombre_plan_pago: true,
      },
    }),
    tx.configuracionSistema.findMany({
      where: {
        clave: CLIENT_OLD_DISCOUNT_KEY,
        gym_id: { in: [input.gymId, "GLOBAL"] },
        is_deleted: false,
      },
      select: { clave: true, valor: true, gym_id: true },
    }),
  ]);
  if (!client) throw new Error(`Cliente ${input.ci} no encontrado.`);
  if (!plan) throw new Error(`Plan ${input.planId} no encontrado.`);
  const category = parseClientCategory(client.categoria ?? "NUEVO");
  const discountPct = resolveClientDiscountPct(settings, input.gymId).value;
  const breakdown = discountBreakdown({
    listPrice: Number(plan.importe_plan_pago).toFixed(2),
    clientCategory: category,
    discountPct,
    planFixedOldPrice:
      plan.precio_viejo_excepcion == null
        ? null
        : Number(plan.precio_viejo_excepcion).toFixed(2),
  });
  return {
    ...breakdown,
    categoria_cliente: category,
    plan_codigo:
      String(plan.codigo ?? "").trim() ||
      String(plan.nombre_plan_pago ?? "").trim() ||
      input.planId,
    plan_nombre: String(plan.nombre_plan_pago ?? "").trim() || input.planId,
    cuota_sufijo: input.numeroCuota ? `/${input.numeroCuota}` : null,
  };
}

export class ClientDiscountQuoteService {
  async quote(input: { gymId: string; ci: string; planId: string; numeroCuota?: number | null }) {
    return resolveClientDiscountQuote(prisma, {
      gymId: input.gymId.trim(),
      ci: input.ci.trim(),
      planId: input.planId.trim(),
      numeroCuota: input.numeroCuota,
    });
  }
}
