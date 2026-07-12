import { Hono } from "hono";
import { prisma } from "../../db/prismaClient";

export const accountingRoutes = new Hono();

const commissionEntity = "entrenador_comision_regla";

function normalizeRuleBody(body: any) {
  return {
    id_entrenador: body.id_entrenador || null,
    id_planes_pago: body.id_planes_pago,
    tipo_calculo: body.tipo_calculo,
    valor_calculo: Number(body.valor_calculo),
    activo: body.activo ?? true,
    fecha_inicio: body.fecha_inicio ? new Date(body.fecha_inicio) : new Date(),
    fecha_fin: body.fecha_fin ? new Date(body.fecha_fin) : null,
    gym_id: body.gym_id || null,
    source_device: body.source_device || null,
  };
}

async function registerRuleSync(
  tx: any,
  operacion: "INSERT" | "UPDATE" | "DELETE",
  record: any,
) {
  await tx.syncLog.create({
    data: {
      event_id: crypto.randomUUID(),
      entidad: commissionEntity,
      operacion,
      entidad_id: record.regla_id,
      gym_id: record.gym_id ?? null,
      device_id: record.source_device ?? null,
      payload_json: JSON.stringify(record),
    },
  });
}

async function listRules() {
  const rules = await prisma.entrenadorComisionRegla.findMany({
    where: { is_deleted: false },
    orderBy: [{ activo: "desc" }, { updated_at: "desc" }],
  });

  const planIds = [
    ...new Set(rules.map((r) => r.id_planes_pago).filter(Boolean)),
  ];
  const trainerIds = [
    ...new Set(rules.map((r) => r.id_entrenador).filter(Boolean) as string[]),
  ];

  const [plans, trainers] = await Promise.all([
    planIds.length
      ? prisma.planesPago.findMany({
          where: { id_planes_pago: { in: planIds } },
        })
      : Promise.resolve([]),
    trainerIds.length
      ? prisma.entrenador.findMany({
          where: { id_entrenador: { in: trainerIds } },
        })
      : Promise.resolve([]),
  ]);

  const planMap = new Map(
    plans.map((p) => [
      p.id_planes_pago,
      p.nombre_plan_pago ?? p.id_planes_pago,
    ]),
  );
  const trainerMap = new Map(
    trainers.map((t) => [
      t.id_entrenador,
      `${t.nombres_entrenador} ${t.apellidos_entrenador}`.trim(),
    ]),
  );

  return rules.map((rule) => ({
    ...rule,
    plan_nombre: planMap.get(rule.id_planes_pago) ?? rule.id_planes_pago,
    entrenador_nombre: rule.id_entrenador
      ? (trainerMap.get(rule.id_entrenador) ?? rule.id_entrenador)
      : "Regla general del plan",
  }));
}

accountingRoutes.get("/summary", async (c) => {
  const now = new Date();
  const [
    pending,
    overdue,
    paid,
    activeRules,
    defaultRules,
    individualRules,
    pendingByCurrency,
  ] = await Promise.all([
    prisma.entrenadorComisionCuota.aggregate({
      where: { estado: "PENDIENTE", is_deleted: false },
      _sum: { monto: true },
      _count: true,
    }),
    prisma.entrenadorComisionCuota.count({
      where: {
        estado: "PENDIENTE",
        is_deleted: false,
        fecha_programada: { lt: now },
      },
    }),
    prisma.entrenadorComisionCuota.count({
      where: { estado: "PAGADO", is_deleted: false },
    }),
    prisma.entrenadorComisionRegla.count({
      where: { activo: true, is_deleted: false },
    }),
    prisma.entrenadorComisionRegla.count({
      where: { id_entrenador: null, activo: true, is_deleted: false },
    }),
    prisma.entrenadorComisionRegla.count({
      where: { id_entrenador: { not: null }, activo: true, is_deleted: false },
    }),
    prisma.entrenadorComisionCuota.groupBy({
      by: ["moneda_id"],
      where: { estado: "PENDIENTE", is_deleted: false },
      _sum: { monto: true },
      _count: true,
    }),
  ]);

  return c.json({
    trainer_commissions: {
      pending_amount: pending._sum.monto ?? 0,
      pending_count: pending._count,
      overdue_count: overdue,
      paid_count: paid,
      pending_by_currency: pendingByCurrency.map((item) => ({
        moneda_id: item.moneda_id,
        amount: item._sum.monto ?? 0,
        count: item._count,
      })),
    },
    rules: {
      active_count: activeRules,
      default_count: defaultRules,
      individual_count: individualRules,
    },
    fixed_payroll: {
      active_profiles: 0,
      pending_payments: 0,
    },
    payout_frequencies: ["WEEKLY", "BIWEEKLY", "MONTHLY"],
  });
});

accountingRoutes.get("/trainer-installments", async (c) => {
  const estado = c.req.query("estado");
  const cuotas = await prisma.entrenadorComisionCuota.findMany({
    where: {
      is_deleted: false,
      ...(estado ? { estado } : {}),
    },
    orderBy: [{ fecha_programada: "asc" }],
  });

  const trainerIds = [...new Set(cuotas.map((q) => q.id_entrenador))];
  const currencyIds = [...new Set(cuotas.map((q) => q.moneda_id))];

  const [trainers, currencies] = await Promise.all([
    trainerIds.length
      ? prisma.entrenador.findMany({
          where: { id_entrenador: { in: trainerIds } },
        })
      : Promise.resolve([]),
    currencyIds.length
      ? prisma.moneda.findMany({ where: { moneda_id: { in: currencyIds } } })
      : Promise.resolve([]),
  ]);

  const trainerMap = new Map(
    trainers.map((t) => [
      t.id_entrenador,
      `${t.nombres_entrenador} ${t.apellidos_entrenador}`.trim(),
    ]),
  );
  const currencyMap = new Map(currencies.map((m) => [m.moneda_id, m.codigo]));

  return c.json(
    cuotas.map((cuota) => ({
      ...cuota,
      entrenador_nombre:
        trainerMap.get(cuota.id_entrenador) ?? cuota.id_entrenador,
      moneda_codigo: currencyMap.get(cuota.moneda_id) ?? cuota.moneda_id,
    })),
  );
});

accountingRoutes.get("/trainer-rules", async (c) => c.json(await listRules()));

accountingRoutes.post("/trainer-rules", async (c) => {
  const body = await c.req.json();
  if (
    !body.id_planes_pago ||
    !body.tipo_calculo ||
    body.valor_calculo === undefined
  ) {
    return c.json(
      { error: "Plan, tipo de cálculo y valor son requeridos" },
      400,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.entrenadorComisionRegla.create({
      data: {
        regla_id: crypto.randomUUID(),
        ...normalizeRuleBody(body),
      },
    });
    await registerRuleSync(tx, "INSERT", created);
    return created;
  });

  return c.json(result, 201);
});

accountingRoutes.put("/trainer-rules/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const data = normalizeRuleBody(body);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.entrenadorComisionRegla.update({
      where: { regla_id: id },
      data: {
        ...data,
        version: { increment: 1 },
        updated_at: new Date(),
      },
    });
    await registerRuleSync(tx, "UPDATE", updated);
    return updated;
  });

  return c.json(result);
});

accountingRoutes.delete("/trainer-rules/:id", async (c) => {
  const id = c.req.param("id");
  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.entrenadorComisionRegla.update({
      where: { regla_id: id },
      data: {
        activo: false,
        is_deleted: true,
        deleted_at: new Date(),
        updated_at: new Date(),
        version: { increment: 1 },
      },
    });
    await registerRuleSync(tx, "DELETE", deleted);
    return deleted;
  });

  return c.json(result);
});
