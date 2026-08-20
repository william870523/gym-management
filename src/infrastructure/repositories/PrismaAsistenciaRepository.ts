import type { Asistencia } from "../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../domain/repositories/AsistenciaRepository";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import { trustedClock } from "../../config/trusted-clock";
import { calendarDayBoundsInZone, datePartsInZone, startOfDayInZone } from "../../config/tz";
import { env } from "../../config/env";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";
import { assertGymScopedReference } from "./gym-scoped-reference";
import { esVisitanteAutorizado } from "./visitante-referencia";

const clienteSummary = {
    select: {
        ci: true,
        nombres: true,
        apellidos: true,
        foto_cliente: true,
        // M4a: visitante es quien pertenece a OTRA sede, no quien falta en la
        // tabla. En el concentrador están TODAS las fichas, así que decidirlo
        // por ausencia no marcaría a nadie nunca.
        gym_id: true,
    },
} as const;

export class PrismaAsistenciaRepository implements AsistenciaRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaAsistenciaRepository {
    return new PrismaAsistenciaRepository(tx);
  }

  // Unidad 01: usa una transacción propia cuando `client` es el prisma raíz;
  // si ya es el cliente de una transacción (upload), la reutiliza en vez de
  // anidar otra —Prisma no soporta transacciones anidadas y un TransactionClient
  // no expone `$transaction`.
  private runInClient<T>(work: (c: any) => Promise<T>): Promise<T> {
    return typeof this.client.$transaction === "function"
      ? this.client.$transaction(work)
      : work(this.client);
  }

  /**
   * M4a — el socio de una asistencia es de esta sede… o un visitante
   * autorizado. La excepción está acotada y se comprueba contra la base; ver
   * `visitante-referencia.ts`.
   *
   * Vive aquí, y no repetida en cada camino, porque **los tres** —el alta por
   * HTTP, la corrección por HTTP y la subida por sincronización— tienen que
   * decir lo mismo. Cuando solo lo sabía la subida, el mostrador web daba
   * «el cliente no pertenece al gimnasio autenticado» al visitante que el
   * escritorio sí dejaba pasar: la misma puerta con dos respuestas.
   */
  private async esSocioAdmisible(tx: any, ci: string, gymId: string): Promise<boolean> {
    const gym = await tx.gym.findUnique({
      where: { gym_id: gymId },
      select: { timezone: true },
    });
    const partes = datePartsInZone(
      gym?.timezone?.trim() || env.defaultGymTimezone,
      trustedClock.nowUtc(),
    );
    const fechaNegocio = new Date(Date.UTC(partes.year, partes.month - 1, partes.day));
    if (await esVisitanteAutorizado({ tx, ci, gymId, fechaNegocio })) return true;
    const propio = await tx.cliente.findFirst({
      where: { ci, gym_id: gymId, is_deleted: false },
      select: { ci: true },
    });
    return Boolean(propio);
  }

    async upsertAsistencia(data: Asistencia): Promise<void> {
        const now = trustedClock.nowUtc();
        if (!data.gym_id) throw new Error("El evento de asistencia no tiene gimnasio autenticado.");
        await this.runInClient(async (tx) => {
            // La subida comparte la regla con el alta por HTTP, pero conserva su
            // redacción: el mensaje de `assertGymScopedReference` es el que la
            // cuarentena guarda y por el que se auditan los rechazos de sync.
            if (!(await this.esSocioAdmisible(tx, data.ci, data.gym_id!))) {
                await assertGymScopedReference({
                    delegate: tx.cliente,
                    entity: "cliente",
                    pk: "ci",
                    id: data.ci,
                    gymId: data.gym_id!,
                });
            }
            await upsertGymScopedSyncRecord({
            delegate: tx.asistencia,
            entity: "asistencia",
            pk: "asistencia_id",
            id: data.asistencia_id,
            gymId: data.gym_id,
            create: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false,
                pausa_inicio: data.pausa_inicio ?? null,
                pausa_ms: data.pausa_ms ?? 0,
                // §5.2 — el rastro de con qué se decidió sube tal cual y no se
                // recalcula aquí: en el concentrador la respuesta sería otra —él
                // siempre está al día— y quedaría escrito que la sede sabía lo
                // que no sabía.
                decidido_con: data.decidido_con ?? null,
                conocimiento_al_decidir: data.conocimiento_al_decidir ?? null,
                dias_sin_noticias: data.dias_sin_noticias ?? null,
                conocimiento_origen_al_decidir:
                    data.conocimiento_origen_al_decidir ?? null,
                dias_sin_noticias_origen: data.dias_sin_noticias_origen ?? null
            },
            update: {
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: now,
                deleted_at: null,
                is_deleted: false,
                pausa_inicio: data.pausa_inicio ?? null,
                pausa_ms: data.pausa_ms ?? 0,
                // §5.2 — el rastro de con qué se decidió sube tal cual y no se
                // recalcula aquí: en el concentrador la respuesta sería otra —él
                // siempre está al día— y quedaría escrito que la sede sabía lo
                // que no sabía.
                decidido_con: data.decidido_con ?? null,
                conocimiento_al_decidir: data.conocimiento_al_decidir ?? null,
                dias_sin_noticias: data.dias_sin_noticias ?? null,
                conocimiento_origen_al_decidir:
                    data.conocimiento_origen_al_decidir ?? null,
                dias_sin_noticias_origen: data.dias_sin_noticias_origen ?? null
            }
            });
        });
    }

    async findAll(
        gymId: string,
        skip: number = 0,
        take: number = 10,
        ci?: string,
        calendarDate?: string,
    ): Promise<Asistencia[]> {
        const gym = calendarDate
            ? await this.client.gym.findUnique({
                where: { gym_id: gymId },
                select: { timezone: true },
            })
            : null;
        if (calendarDate && !gym?.timezone) {
            throw new Error("Gym timezone not found");
        }
        const bounds = calendarDate
            ? calendarDayBoundsInZone(gym.timezone, calendarDate)
            : null;
        const results = await this.client.asistencia.findMany({
            skip,
            take,
            where: {
                gym_id: gymId,
                ci,
                is_deleted: false,
                ...(bounds
                    ? { created_at: { gte: bounds.startUtc, lte: bounds.endUtc } }
                    : {}),
            },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.conVisitantes(this.serializeClients(results), gymId);
    }

    async findActive(gymId: string, skip: number = 0, take: number = 100): Promise<Asistencia[]> {
        const results = await this.client.asistencia.findMany({
            skip,
            take,
            where: {
                gym_id: gymId,
                is_deleted: false,
                fecha_salida: null,
            },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.conVisitantes(this.serializeClients(results), gymId);
    }

    async findToday(gymId: string): Promise<Asistencia[]> {
        const gym = await this.client.gym.findUnique({
            where: { gym_id: gymId },
            select: { timezone: true },
        });
        if (!gym?.timezone) throw new Error("Gym timezone not found");
        const { startUtc: startOfDay, endUtc: endOfDay } = startOfDayInZone(
            gym.timezone,
            trustedClock.nowUtc(),
        );

        const results = await this.client.asistencia.findMany({
            where: {
                is_deleted: false,
                gym_id: gymId,
                created_at: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.conVisitantes(this.serializeClients(results), gymId);
    }

    /**
     * M4a — rellena con la copia de visitante las filas cuyo socio no está en
     * `cliente` de esta sede. Gemela de la del escritorio: sin esto, la
     * entrada de un socio de otra sede sale sin nombre.
     */
    private async conVisitantes(results: any[], gymId: string): Promise<Asistencia[]> {
        for (const fila of results) {
            const sede = fila.cliente?.gym_id;
            if (sede && sede !== gymId) {
                fila.visitante = true;
                fila.gym_id_origen = sede;
            }
        }
        const sinFicha = results.filter((r) => !r.cliente).map((r) => r.ci);
        if (sinFicha.length === 0) return results;
        const copias = await this.client.clienteVisitante.findMany({
            where: { ci: { in: sinFicha } },
        });
        const porCi = new Map(copias.map((c: any) => [c.ci, c]));
        for (const fila of results) {
            const copia: any = fila.cliente ? null : porCi.get(fila.ci);
            if (!copia) continue;
            fila.cliente = {
                ci: copia.ci,
                nombres: copia.nombres,
                apellidos: copia.apellidos,
                foto_cliente: Buffer.isBuffer(copia.foto_cliente)
                    ? copia.foto_cliente.toString("base64")
                    : null,
            };
            fila.visitante = true;
            fila.gym_id_origen = copia.gym_id_origen;
        }
        return results;
    }

    private serializeClients(results: any[]): Asistencia[] {
        return results.map((record) => ({
            ...record,
            cliente: record.cliente
                ? {
                    ...record.cliente,
                    foto_cliente: Buffer.isBuffer(record.cliente.foto_cliente)
                        ? record.cliente.foto_cliente.toString("base64")
                        : record.cliente.foto_cliente,
                }
                : null,
        })) as Asistencia[];
    }

    async findById(id: string, gymId: string): Promise<Asistencia | null> {
        return this.client.asistencia.findFirst({
            where: { asistencia_id: id, gym_id: gymId, is_deleted: false }
        });
    }

    async create(data: Asistencia): Promise<void> {
        if (!data.gym_id) throw new Error("El token debe identificar el gimnasio de la asistencia.");
        if (!(await this.esSocioAdmisible(this.client, data.ci, data.gym_id))) {
            throw new Error("El cliente no pertenece al gimnasio autenticado.");
        }
        const now = trustedClock.nowUtc();
        await this.client.asistencia.create({
            data: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false,
                // §5.2 — lo decide el caso de uso, que es quien sabe si el socio
                // era visitante; el repositorio solo lo escribe.
                decidido_con: data.decidido_con ?? null,
                conocimiento_al_decidir: data.conocimiento_al_decidir ?? null,
                dias_sin_noticias: data.dias_sin_noticias ?? null,
                conocimiento_origen_al_decidir:
                    data.conocimiento_origen_al_decidir ?? null,
                dias_sin_noticias_origen: data.dias_sin_noticias_origen ?? null
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<Asistencia>): Promise<void> {
        await this.runInClient(async (tx) => {
            if (data.ci && !(await this.esSocioAdmisible(tx, data.ci, gymId))) {
                throw new Error("El cliente no pertenece al gimnasio autenticado.");
            }
            const result = await tx.asistencia.updateMany({
                where: { asistencia_id: id, gym_id: gymId, is_deleted: false },
                data: {
                ci: data.ci,
                fecha_salida: data.fecha_salida,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
                },
            });
            if (result.count !== 1) throw new Error("Asistencia not found");
        });
    }

    async finalize(id: string, gymId: string, fechaSalida: Date): Promise<Asistencia> {
        const result = await this.client.asistencia.updateMany({
            where: { asistencia_id: id, gym_id: gymId, is_deleted: false },
            data: {
                fecha_salida: fechaSalida,
                version: { increment: 1 },
                updated_at: fechaSalida,
            },
        });
        if (result.count !== 1) throw new Error("Asistencia not found");
        const updated = await this.findById(id, gymId);
        if (!updated) throw new Error("Asistencia not found");
        return updated;
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await softDeleteGymScopedSyncRecord({
            delegate: this.client.asistencia,
            entity: "asistencia",
            pk: "asistencia_id",
            id,
            gymId,
            now,
        });
    }
}
