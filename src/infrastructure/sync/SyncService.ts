// src/infrastructure/sync/SyncService.ts
// src/infrastructure/sync/SyncService.ts
import { prisma } from "../db/prismaClient";
import {
  UploadEventsDTO,
  ChangesQueryDTO
} from "../../application/validation/sync.schemas";
import { PrismaClienteRepository } from "../repositories/PrismaClienteRepository";
import { PrismaClientePesoRepository } from "../repositories/PrismaClientePesoRepository";
import { PrismaAsistenciaRepository } from "../repositories/PrismaAsistenciaRepository";
import { PrismaPagoClienteRepository } from "../repositories/PrismaPagoClienteRepository";
import { PrismaDetallePagoRepository } from "../repositories/PrismaDetallePagoRepository";
import { PrismaMonedaRepository } from "../repositories/PrismaMonedaRepository";
import { PrismaNacionalidadRepository } from "../repositories/PrismaNacionalidadRepository";
import { PrismaTipoPagoRepository } from "../repositories/PrismaTipoPagoRepository";
import { PrismaTipoCambioRepository } from "../repositories/PrismaTipoCambioRepository";
import { PrismaReferenciaRepository } from "../repositories/PrismaReferenciaRepository";
import { PrismaHorarioRepository } from "../repositories/PrismaHorarioRepository";
import { PrismaPlanesPagoRepository } from "../repositories/PrismaPlanesPagoRepository";
import { PrismaCuentaRepository } from "../repositories/PrismaCuentaRepository";
import { PrismaEntrenadorRepository } from "../repositories/PrismaEntrenadorRepository";
import { PrismaUserRepository } from "../repositories/PrismaUserRepository";
import { PrismaSyncLogRepository } from "../repositories/PrismaSyncLogRepository";
import { PrismaGymRepository } from "../repositories/PrismaGymRepository";

import { ApplyClienteEventUseCase } from "../../application/use-cases/sync/ApplyClienteEventUseCase";
import { ApplyClientePesoEventUseCase } from "../../application/use-cases/sync/ApplyClientePesoEventUseCase";
import { ApplyAsistenciaEventUseCase } from "../../application/use-cases/sync/ApplyAsistenciaEventUseCase";
import { ApplyPagoClienteEventUseCase } from "../../application/use-cases/sync/ApplyPagoClienteEventUseCase";
import { ApplyDetallePagoEventUseCase } from "../../application/use-cases/sync/ApplyDetallePagoEventUseCase";
import { ApplyMonedaEventUseCase } from "../../application/use-cases/sync/ApplyMonedaEventUseCase";
import { ApplyNacionalidadEventUseCase } from "../../application/use-cases/sync/ApplyNacionalidadEventUseCase";
import { ApplyTipoPagoEventUseCase } from "../../application/use-cases/sync/ApplyTipoPagoEventUseCase";
import { ApplyTipoCambioEventUseCase } from "../../application/use-cases/sync/ApplyTipoCambioEventUseCase";
import { ApplyReferenciaEventUseCase } from "../../application/use-cases/sync/ApplyReferenciaEventUseCase";
import { ApplyHorarioEventUseCase } from "../../application/use-cases/sync/ApplyHorarioEventUseCase";
import { ApplyPlanesPagoEventUseCase } from "../../application/use-cases/sync/ApplyPlanesPagoEventUseCase";
import { ApplyCuentaEventUseCase } from "../../application/use-cases/sync/ApplyCuentaEventUseCase";
import { ApplyEntrenadorEventUseCase } from "../../application/use-cases/sync/ApplyEntrenadorEventUseCase";
import { ApplyUserEventUseCase } from "../../application/use-cases/sync/ApplyUserEventUseCase";
import { ApplyGymEventUseCase } from "../../application/use-cases/sync/ApplyGymEventUseCase";
import { UploadEventsUseCase } from "../../application/use-cases/sync/UploadEventsUseCase";
import { databaseUtcNow } from "../time/time.service";

export class SyncService {
  private uploadEventsUseCase: UploadEventsUseCase;
  private syncLogRepository: PrismaSyncLogRepository;

  // Inicializa los componentes necesarios para procesar eventos de sync.
  constructor() {
    const clienteRepository = new PrismaClienteRepository();
    const clientePesoRepository = new PrismaClientePesoRepository();
    const asistenciaRepository = new PrismaAsistenciaRepository();
    const pagoClienteRepository = new PrismaPagoClienteRepository();
    const detallePagoRepository = new PrismaDetallePagoRepository();
    const monedaRepository = new PrismaMonedaRepository();
    const nacionalidadRepository = new PrismaNacionalidadRepository();
    const tipoPagoRepository = new PrismaTipoPagoRepository();
    const tipoCambioRepository = new PrismaTipoCambioRepository();
    const referenciaRepository = new PrismaReferenciaRepository();
    const horarioRepository = new PrismaHorarioRepository();
    const planesPagoRepository = new PrismaPlanesPagoRepository();
    const cuentaRepository = new PrismaCuentaRepository();
    const entrenadorRepository = new PrismaEntrenadorRepository();
    const userRepository = new PrismaUserRepository();
    const syncLogRepository = new PrismaSyncLogRepository();
    const gymRepository = new PrismaGymRepository();
    // Repository is already instantiated here, let's use it
    this.syncLogRepository = syncLogRepository;

    const applyClienteEventUseCase = new ApplyClienteEventUseCase(clienteRepository);
    const applyClientePesoEventUseCase = new ApplyClientePesoEventUseCase(clientePesoRepository);
    const applyAsistenciaEventUseCase = new ApplyAsistenciaEventUseCase(asistenciaRepository);
    const applyPagoClienteEventUseCase = new ApplyPagoClienteEventUseCase(pagoClienteRepository);
    const applyDetallePagoEventUseCase = new ApplyDetallePagoEventUseCase(detallePagoRepository);
    const applyMonedaEventUseCase = new ApplyMonedaEventUseCase(monedaRepository);
    const applyNacionalidadEventUseCase = new ApplyNacionalidadEventUseCase(nacionalidadRepository);
    const applyTipoPagoEventUseCase = new ApplyTipoPagoEventUseCase(tipoPagoRepository);
    const applyTipoCambioEventUseCase = new ApplyTipoCambioEventUseCase(tipoCambioRepository);
    const applyReferenciaEventUseCase = new ApplyReferenciaEventUseCase(referenciaRepository);
    const applyHorarioEventUseCase = new ApplyHorarioEventUseCase(horarioRepository);
    const applyPlanesPagoEventUseCase = new ApplyPlanesPagoEventUseCase(planesPagoRepository);
    const applyCuentaEventUseCase = new ApplyCuentaEventUseCase(cuentaRepository);
    const applyEntrenadorEventUseCase = new ApplyEntrenadorEventUseCase(entrenadorRepository);
    const applyUserEventUseCase = new ApplyUserEventUseCase(userRepository);
    // La autoridad de Dueño se resuelve contra la base del remoto, no contra el
    // payload del evento (docs/MULTI_SEDE.md §3).
    const applyGymEventUseCase = new ApplyGymEventUseCase(
      gymRepository,
      async (userId) => {
        const cuenta = await prisma.user.findFirst({
          where: { user_id: userId, active: true, is_deleted: false },
          select: { es_plataforma: true },
        });
        return cuenta?.es_plataforma === true;
      },
    );

    this.uploadEventsUseCase = new UploadEventsUseCase(
      syncLogRepository,
      applyClienteEventUseCase,
      applyClientePesoEventUseCase,
      applyAsistenciaEventUseCase,
      applyPagoClienteEventUseCase,
      applyDetallePagoEventUseCase,
      applyMonedaEventUseCase,
      applyNacionalidadEventUseCase,
      applyTipoPagoEventUseCase,
      applyTipoCambioEventUseCase,
      applyReferenciaEventUseCase,
      applyHorarioEventUseCase,
      applyPlanesPagoEventUseCase,
      applyCuentaEventUseCase,
      applyEntrenadorEventUseCase,
      applyUserEventUseCase,
      applyGymEventUseCase
    );
  }

  /**
   * Recibe eventos desde un backend local y delega en el caso de uso.
   */
  async uploadEvents(dto: UploadEventsDTO) {
    return this.uploadEventsUseCase.execute(dto);
  }

  // =========================================================
  //  LECTURA DE CAMBIOS PARA LOS CLIENTES
  // =========================================================

  // Obtiene los eventos recientes desde sync_log filtrando por gym.
  async getChanges(query: ChangesQueryDTO) {
    const gymId = query.gym_id;
    const sinceDate = query.since ? new Date(query.since) : undefined;
    // El ID autoincremental evita perder eventos que comparten created_at.
    const [watermark, maxId] = await Promise.all([
      databaseUtcNow(),
      prisma.syncLog.aggregate({ _max: { id: true } }),
    ]);
    const watermarkId = maxId._max.id ?? 0;
    const events = await this.syncLogRepository.findChanges(
      { afterId: query.after_id, since: sinceDate },
      watermarkId,
      gymId,
    );
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const pageIsFull = events.length >= 1000;
    const nextCursorId = pageIsFull
      ? Number(lastEvent?.cursor_id ?? query.after_id ?? 0)
      : watermarkId;
    const nextCursor =
      pageIsFull && lastEvent?.created_at
        ? new Date(lastEvent.created_at)
        : watermark;

    return {
      events,
      next_cursor: nextCursor.toISOString(),
      next_cursor_id: nextCursorId,
      has_more: nextCursorId < watermarkId,
      server_utc: watermark.toISOString(),
    };
  }
}
