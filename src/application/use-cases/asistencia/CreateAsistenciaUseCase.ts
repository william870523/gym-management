import { randomUUID } from "crypto";
import type { CreateAsistenciaDTO } from "../../dtos/AsistenciaDTO";
import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";
import { trustedClock } from "../../../config/trusted-clock";
import {
    decidirEntrada,
    decidirEntradaVisitante,
} from "../../../domain/asistencia-elegibilidad-policy";
import {
    decidirVisita,
    esVisitanteDeOtraSede,
} from "../../../domain/acceso-multisede-policy";
import { AsistenciaElegibilidadService } from "../../asistencia/asistencia-elegibilidad.service";
import {
    conocimientoDeLaSedeDeOrigen,
    rastroDelConcentrador,
} from "../../../domain/conocimiento-de-la-copia-policy";
import { ultimaNoticiaDeLaSede } from "../../../infrastructure/sync/noticia-de-la-sede";
import { prisma } from "../../../infrastructure/db/prismaClient";

/** Rechazo de negocio, no fallo del sistema: se traduce a 409. */
export class AsistenciaElegibilidadError extends Error {
    readonly status = 409;
    constructor(message: string) {
        super(message);
        this.name = "AsistenciaElegibilidadError";
    }
}

export class CreateAsistenciaUseCase {
    constructor(
        private readonly asistenciaRepository: AsistenciaRepository,
        private readonly elegibilidad = new AsistenciaElegibilidadService(),
    ) { }

    /**
     * `creada` distingue el alta real de la repetición idempotente. El
     * controlador lo necesita: emitir el evento de sync también cuando el socio
     * ya estaba dentro metería en la cola un INSERT de una fila que ya existe.
     */
    async execute(
        dto: CreateAsistenciaDTO,
        gymId: string,
    ): Promise<{ asistencia: Asistencia; creada: boolean }> {
        // Hasta ahora la web creaba la asistencia sin preguntar nada: se podía
        // marcar la entrada de un socio pausado, pendiente de pago o con la
        // cuota vencida, y marcarla dos veces. El mostrador nunca lo permitió.
        // La regla es la misma para las dos superficies y vive en el dominio.
        const [entradaAbierta, fechaNegocio, esPropio] = await Promise.all([
            this.elegibilidad.entradaAbierta(dto.ci, gymId),
            this.elegibilidad.fechaDeNegocio(gymId),
            this.elegibilidad.esSocioDeLaSede(dto.ci, gymId),
        ]);

        // M4a — el socio de otra sede se decide con lo único que hay de él
        // aquí: su copia de solo lectura y su acceso multi-sede.
        // §5.2, segundo eje — de cuándo es lo que se sabe del visitante. En la
        // web decide el concentrador, que está al día consigo mismo; lo que no
        // está garantizado es que la sede del socio haya hablado hoy, y sin
        // medirlo el rastro afirmaría más de lo que consta.
        const rastro = esPropio
            ? null
            : rastroDelConcentrador(
                conocimientoDeLaSedeDeOrigen({
                    ultimaNoticia: await this.ultimaNoticiaDelSocio(dto.ci, gymId),
                    fechaNegocio,
                }),
            );

        const decision = esPropio
            ? decidirEntrada({
                tieneEntradaAbierta: Boolean(entradaAbierta),
                membresias: await this.elegibilidad.membresiasParaEntrada(
                    dto.ci,
                    gymId,
                ),
                fechaNegocio,
            })
            : await this.decidirVisitante(dto.ci, gymId, Boolean(entradaAbierta), fechaNegocio);

        // La entrada es idempotente por socio: repetirla devuelve la misma fila
        // y no genera otro evento de sincronización, como en el escritorio.
        if (decision.resultado === "YA_DENTRO") {
            return { asistencia: entradaAbierta as Asistencia, creada: false };
        }
        if (decision.resultado === "BLOQUEADA") {
            throw new AsistenciaElegibilidadError(decision.motivo);
        }

        const occurredAt = trustedClock.nowUtc();
        const newAsistencia: Asistencia = {
            asistencia_id: dto.asistencia_id ?? randomUUID(),
            ci: dto.ci,
            fecha_salida: dto.fecha_salida ?? null,
            gym_id: gymId,
            source_device: null,
            version: 1,
            created_at: occurredAt,
            updated_at: occurredAt,
            deleted_at: null,
            is_deleted: false,
            // §5.2 — con qué se decidió, congelado en la fila. En la web decide
            // el propio concentrador, así que no hay retraso que declarar: la
            // pregunta «¿cuánto hace que bajé datos?» no se le hace al origen.
            // En la entrada de un socio de la casa no hay nada que declarar.
            decidido_con: rastro?.decididoCon ?? null,
            conocimiento_al_decidir: rastro?.conocimiento ?? null,
            dias_sin_noticias: rastro?.diasSinNoticias ?? null,
            conocimiento_origen_al_decidir: rastro?.conocimientoOrigen ?? null,
            dias_sin_noticias_origen: rastro?.diasSinNoticiasOrigen ?? null
        };

        await this.asistenciaRepository.create(newAsistencia);
        return { asistencia: newAsistencia, creada: true };
    }

    /**
     * Cuándo se supo por última vez de la sede del socio.
     *
     * Se pregunta por la sede **dueña**, no por la visitada: la que puede estar
     * muda es la que tiene su ficha. Si el socio es de aquí no hay nada que
     * medir, y se responde `null`, que se lee «no consta».
     */
    private async ultimaNoticiaDelSocio(
        ci: string,
        gymId: string,
    ): Promise<Date | null> {
        const copia = await prisma.clienteVisitante.findFirst({
            where: { ci, is_deleted: false },
            select: { gym_id_origen: true },
        });
        const origen = String(copia?.gym_id_origen ?? "").trim();
        if (!origen || origen === gymId) return null;
        return ultimaNoticiaDeLaSede(prisma as never, origen);
    }

    /**
     * Entrada de un socio de otra sede (M4a, docs/MULTI_SEDE.md §5.2).
     *
     * Gemelo del camino del escritorio: la sede visitada no tiene sus
     * membresías, así que decide con la copia replicada y el plus. Sin copia
     * viva no es un visitante, es un desconocido, y se le trata como tal.
     */
    private async decidirVisitante(
        ci: string,
        gymId: string,
        tieneEntradaAbierta: boolean,
        fechaNegocio: Date,
    ) {
        const { copia, acceso } = await this.elegibilidad.visitante(ci);
        if (!esVisitanteDeOtraSede(copia, gymId)) {
            return {
                resultado: "BLOQUEADA" as const,
                status: 409 as const,
                motivo:
                    "El socio no pertenece a esta sede y no tiene acceso multi-sede vigente.",
            };
        }
        return decidirEntradaVisitante({
            tieneEntradaAbierta,
            visita: decidirVisita({
                gymIdDelSocio: copia.gym_id_origen,
                gymIdDeLaSede: gymId,
                acceso,
                fechaNegocio,
            }),
            copia,
            fechaNegocio,
        });
    }
}
