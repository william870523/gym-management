export async function assertGymScopedReference(input: {
  delegate: any;
  entity: string;
  pk: string;
  id: string;
  gymId: string;
  extraWhere?: Record<string, unknown>;
}) {
  const reference = await input.delegate.findFirst({
    where: {
      [input.pk]: input.id,
      gym_id: input.gymId,
      is_deleted: false,
      ...(input.extraWhere ?? {}),
    },
    select: { [input.pk]: true },
  });
  if (!reference) {
    throw new Error(
      `${input.entity} ${input.id} no pertenece al gimnasio autenticado.`,
    );
  }
}
