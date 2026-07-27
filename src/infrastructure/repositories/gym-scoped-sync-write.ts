type GymOwnedRecord = {
  gym_id: string | null;
};

function requireAuthenticatedGymId(gymId: string | null | undefined) {
  const normalized = String(gymId ?? "").trim();
  if (!normalized) {
    throw new Error("El evento de sync no tiene un gimnasio autenticado.");
  }
  return normalized;
}

function assertOwnedByGym(input: {
  entity: string;
  id: string;
  gymId: string;
  existing: GymOwnedRecord | null;
}) {
  if (input.existing && input.existing.gym_id !== input.gymId) {
    throw new Error(
      `No se puede sincronizar ${input.entity} ${input.id}: ` +
        "la PK ya pertenece a otro gimnasio.",
    );
  }
}

/**
 * Escritura de sync para modelos cuya PK es global aunque la fila pertenezca
 * a un gimnasio. Nunca usa `upsert`: una PK ajena falla y una carrera de
 * creación termina en conflicto único, sin reasignar silenciosamente la fila.
 */
export async function upsertGymScopedSyncRecord(input: {
  delegate: any;
  entity: string;
  pk: string;
  id: string;
  gymId: string | null | undefined;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}) {
  const gymId = requireAuthenticatedGymId(input.gymId);
  const existing = await input.delegate.findUnique({
    where: { [input.pk]: input.id },
    select: { gym_id: true },
  });
  assertOwnedByGym({
    entity: input.entity,
    id: input.id,
    gymId,
    existing,
  });

  if (!existing) {
    await input.delegate.create({
      data: {
        ...input.create,
        [input.pk]: input.id,
        gym_id: gymId,
      },
    });
    return;
  }

  const update: Record<string, unknown> = {
    ...input.update,
    gym_id: gymId,
  };
  delete update[input.pk];
  const result = await input.delegate.updateMany({
    where: { [input.pk]: input.id, gym_id: gymId },
    data: update,
  });
  if (result.count !== 1) {
    throw new Error(
      `No se pudo actualizar ${input.entity} ${input.id} ` +
        "dentro del gimnasio autenticado.",
    );
  }
}

/**
 * DELETE idempotente y scoped. Una fila inexistente se considera aplicada;
 * una fila con la misma PK en otro gimnasio se rechaza explícitamente.
 */
export async function softDeleteGymScopedSyncRecord(input: {
  delegate: any;
  entity: string;
  pk: string;
  id: string;
  gymId: string | null | undefined;
  now: Date;
}) {
  const gymId = requireAuthenticatedGymId(input.gymId);
  const existing = await input.delegate.findUnique({
    where: { [input.pk]: input.id },
    select: { gym_id: true },
  });
  assertOwnedByGym({
    entity: input.entity,
    id: input.id,
    gymId,
    existing,
  });
  if (!existing) return;

  const result = await input.delegate.updateMany({
    where: { [input.pk]: input.id, gym_id: gymId },
    data: {
      is_deleted: true,
      deleted_at: input.now,
      updated_at: input.now,
    },
  });
  if (result.count !== 1) {
    throw new Error(
      `No se pudo eliminar ${input.entity} ${input.id} ` +
        "dentro del gimnasio autenticado.",
    );
  }
}
