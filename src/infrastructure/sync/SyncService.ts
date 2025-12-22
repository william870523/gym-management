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
import { UploadEventsUseCase } from "../../application/use-cases/sync/UploadEventsUseCase";

export class SyncService {
  private uploadEventsUseCase: UploadEventsUseCase;

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
      applyUserEventUseCase
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
    const sinceDate = new Date(query.since);
    const gymId = query.gym_id;

    const events = await prisma.syncLog.findMany({
      where: {
        created_at: { gt: sinceDate },
        OR: [{ gym_id: gymId }, { gym_id: null }]
      },
      orderBy: { created_at: "asc" },
      take: 1000
    });

    return events.map((e) => ({
      event_id: e.event_id,
      entidad: e.entidad,
      operacion: e.operacion,
      entidad_id: e.entidad_id,
      gym_id: e.gym_id,
      device_id: e.device_id,
      payload: JSON.parse(e.payload_json),
      created_at: e.created_at
    }));
  }
}
