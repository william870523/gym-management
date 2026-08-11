import { randomUUID } from "crypto";
import type { CreateAsistenciaDTO } from "../../dtos/AsistenciaDTO";
import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { decidirEntrada } from "../../../domain/asistencia-elegibilidad-policy";
import { AsistenciaElegibilidadService } from "../../asistencia/asistencia-elegibilidad.service";

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
        const [entradaAbierta, membresias] = await Promise.all([
            this.elegibilidad.entradaAbierta(dto.ci, gymId),
            this.elegibilidad.membresiasParaEntrada(dto.ci, gymId),
        ]);

        const decision = decidirEntrada({
            tieneEntradaAbierta: Boolean(entradaAbierta),
            membresias,
        });

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
            is_deleted: false
        };

        await this.asistenciaRepository.create(newAsistencia);
        return { asistencia: newAsistencia, creada: true };
    }
}
