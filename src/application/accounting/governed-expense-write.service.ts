import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import { parseTreasuryMonth, treasuryMinorToMoney, treasuryMoneyToMinor } from "../../domain/treasury-ledger-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { CompensationProfileService } from "./compensation-profile.service";
import { TreasuryLedgerService } from "./treasury-ledger.service";
import { assertTreasuryMonthOpen } from "./treasury-month-lock.service";
import { serialize } from "../../shared/utils/serialize";

type Tx = Prisma.TransactionClient;
const DEVICE_ID = "WEB_ADMIN";

export class GovernedExpenseWriteServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "GovernedExpenseWriteServiceError";
  }
}

export interface CreateExpenseCategoryInput {
  nombre: string;
  naturaleza: "OPERATIVO" | "ADMINISTRATIVO" | "COSTO_VENTAS";
  es_sistema?: boolean;
}

export interface CreateExpenseSupplierInput {
  nombre: string;
  documento?: string | null;
  cuenta_pago_default_id?: string | null;
}

export interface CreateGovernedExpenseInput {
  categoria_id: string;
  proveedor_id?: string | null;
  moneda_id: string;
  descripcion: string;
  monto: string | number;
  periodo_pertenencia_mes: string;
  fecha_programada?: Date | string | null;
  comprobante_referencia?: string | null;
  registrada_por_user_id?: string | null;
  /** R4.7: plantilla que generó el gasto; null o ausente = gasto manual. */
  recurrente_id?: string | null;
}

export interface PayGovernedExpenseInput {
  gasto_id: string;
  monto: string | number;
  cuenta_id?: string | null;
  tipo_pago_id?: string | null;
  comprobante_referencia?: string | null;
  registrada_por_user_id?: string | null;
}

export interface ReverseGovernedExpensePaymentInput {
  aplicacion_id: string;
  motivo: string;
  registrada_por_user_id?: string | null;
}

export class GovernedExpenseWriteService {
  private readonly profiles = new CompensationProfileService();
  private readonly treasuryLedger = new TreasuryLedgerService();

  async listCategories(gymId: string) {
    return prisma.gastoCategoria.findMany({
      where: { gym_id: gymId, is_deleted: false },
      orderBy: { nombre: "asc" },
    });
  }

  async createCategory(gymId: string, input: CreateExpenseCategoryInput) {
    const nombre = input.nombre.trim();
    if (!nombre) {
      throw new GovernedExpenseWriteServiceError("El nombre de la categoría es obligatorio.");
    }
    const naturaleza = String(input.naturaleza ?? "").trim().toUpperCase();
    if (!["OPERATIVO", "ADMINISTRATIVO", "COSTO_VENTAS"].includes(naturaleza)) {
      throw new GovernedExpenseWriteServiceError(
        "La naturaleza debe ser OPERATIVO, ADMINISTRATIVO o COSTO_VENTAS.",
      );
    }
    const now = trustedClock.nowUtc();
    const categoriaId = `cat_${randomUUID()}`;

    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.gastoCategoria.findFirst({
        where: { gym_id: gymId, nombre, is_deleted: false },
      });
      if (existing) {
        throw new GovernedExpenseWriteServiceError(`Ya existe una categoría con el nombre "${nombre}".`);
      }

      const row = await tx.gastoCategoria.create({
        data: {
          categoria_id: categoriaId,
          gym_id: gymId,
          nombre,
          naturaleza,
          es_sistema: input.es_sistema ?? false,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          source_device: DEVICE_ID,
          version: 1,
        },
      });
      await this.recordSync(tx, "gasto_categoria", "INSERT", gymId, row.categoria_id, row);
      return row;
    });
  }

  async listSuppliers(gymId: string) {
    return prisma.gastoProveedor.findMany({
      where: { gym_id: gymId, is_deleted: false },
      orderBy: { nombre: "asc" },
    });
  }

  async createSupplier(gymId: string, input: CreateExpenseSupplierInput) {
    const nombre = input.nombre.trim();
    if (!nombre) {
      throw new GovernedExpenseWriteServiceError("El nombre del proveedor es obligatorio.");
    }
    const doc = input.documento ? input.documento.trim() : null;
    const now = trustedClock.nowUtc();
    const proveedorId = `prov_${randomUUID()}`;

    return prisma.$transaction(async (tx: Tx) => {
      if (input.cuenta_pago_default_id) {
        const account = await tx.cuenta.findFirst({
          where: {
            cuenta_id: input.cuenta_pago_default_id,
            gym_id: gymId,
            is_deleted: false,
          },
          select: { cuenta_id: true },
        });
        if (!account) {
          throw new GovernedExpenseWriteServiceError(
            "La cuenta predeterminada no pertenece al gimnasio.",
          );
        }
      }
      if (doc) {
        const existingDoc = await tx.gastoProveedor.findFirst({
          where: { gym_id: gymId, documento: doc, is_deleted: false },
        });
        if (existingDoc) {
          throw new GovernedExpenseWriteServiceError(`Ya existe un proveedor con el documento "${doc}".`);
        }
      }

      const row = await tx.gastoProveedor.create({
        data: {
          proveedor_id: proveedorId,
          gym_id: gymId,
          nombre,
          documento: doc,
          cuenta_pago_default_id: input.cuenta_pago_default_id ?? null,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          source_device: DEVICE_ID,
          version: 1,
        },
      });
      await this.recordSync(tx, "gasto_proveedor", "INSERT", gymId, row.proveedor_id, row);
      return row;
    });
  }

  async createExpense(
    gymId: string,
    input: CreateGovernedExpenseInput,
    existingTx?: Tx,
  ) {
    const period = parseTreasuryMonth(input.periodo_pertenencia_mes);
    const montoMinor = treasuryMoneyToMinor(input.monto);
    if (montoMinor <= 0n) {
      throw new GovernedExpenseWriteServiceError("El monto del gasto debe ser positivo.");
    }
    const desc = input.descripcion.trim();
    if (!desc) {
      throw new GovernedExpenseWriteServiceError("La descripción del gasto es obligatoria.");
    }

    const now = trustedClock.nowUtc();
    const gastoId = `gasto_${randomUUID()}`;

    const createInTx = async (tx: Tx) => {
      // El gasto devengado del mes entra al resultado certificado (snapshot v4),
      // así que un mes ya firmado no puede recibir gasto nuevo: cambiaría la
      // cifra que la firma dice congelada. El bloqueo mira el mes de
      // pertenencia, no el día en que se registra.
      await assertTreasuryMonthOpen(tx, gymId, period.start);

      const category = await tx.gastoCategoria.findFirst({
        where: { categoria_id: input.categoria_id, gym_id: gymId, is_deleted: false },
      });
      if (!category) {
        throw new GovernedExpenseWriteServiceError("La categoría especificada no existe.");
      }

      if (input.proveedor_id) {
        const supplier = await tx.gastoProveedor.findFirst({
          where: { proveedor_id: input.proveedor_id, gym_id: gymId, is_deleted: false },
        });
        if (!supplier) {
          throw new GovernedExpenseWriteServiceError("El proveedor especificado no existe.");
        }
      }

      const rawFechaProg = input.fecha_programada
        ? new Date(input.fecha_programada)
        : now;
      if (Number.isNaN(rawFechaProg.getTime())) {
        throw new GovernedExpenseWriteServiceError(
          "La fecha programada no es válida.",
        );
      }
      const fechaProg = new Date(
        Date.UTC(
          rawFechaProg.getUTCFullYear(),
          rawFechaProg.getUTCMonth(),
          rawFechaProg.getUTCDate(),
        ),
      );

      const formulaSnapshot = {
        categoria_nombre: category.nombre,
        naturaleza: category.naturaleza,
        creado_at: now.toISOString(),
      };

      const currency = await tx.moneda.findFirst({
        where: { moneda_id: input.moneda_id, is_deleted: false },
        select: { moneda_id: true },
      });
      if (!currency) {
        throw new GovernedExpenseWriteServiceError("La moneda especificada no existe.");
      }

      const row = await tx.gastoGobernado.create({
        data: {
          gasto_id: gastoId,
          gym_id: gymId,
          categoria_id: input.categoria_id,
          proveedor_id: input.proveedor_id ?? null,
          moneda_id: input.moneda_id,
          descripcion: desc,
          monto: treasuryMinorToMoney(montoMinor),
          periodo_pertenencia_mes: period.month,
          fecha_pago: null,
          fecha_programada: fechaProg,
          recurrente_id: input.recurrente_id ?? null,
          metodo_devengo: "MES_PERTENENCIA",
          estado: "PENDIENTE",
          pagado_acumulado: 0,
          comprobante_referencia: input.comprobante_referencia ?? null,
          registrada_por_user_id: input.registrada_por_user_id ?? "SYSTEM",
          formula_snapshot_json: JSON.stringify(formulaSnapshot),
          is_deleted: false,
          created_at: now,
          updated_at: now,
          source_device: DEVICE_ID,
          version: 1,
        },
      });
      await this.recordSync(tx, "gasto_gobernado", "INSERT", gymId, row.gasto_id, row);
      return row;
    };
    return existingTx ? createInTx(existingTx) : prisma.$transaction(createInTx);
  }

  async payExpense(gymId: string, input: PayGovernedExpenseInput) {
    const payMinor = treasuryMoneyToMinor(input.monto);
    if (payMinor <= 0n) {
      throw new GovernedExpenseWriteServiceError("El monto del pago debe ser positivo.");
    }
    const now = trustedClock.nowUtc();

    return prisma.$transaction(async (tx: Tx) => {
      const expense = await tx.gastoGobernado.findFirst({
        where: { gasto_id: input.gasto_id, gym_id: gymId, is_deleted: false },
      });
      if (!expense) {
        throw new GovernedExpenseWriteServiceError("El gasto especificado no existe.");
      }
      if (expense.estado === "ANULADO") {
        throw new GovernedExpenseWriteServiceError("No se puede pagar un gasto anulado.");
      }
      if (expense.estado === "PAGADO") {
        throw new GovernedExpenseWriteServiceError("El gasto ya está pagado en su totalidad.");
      }

      const totalMinor = treasuryMoneyToMinor(expense.monto.toString());
      const currentPaidMinor = treasuryMoneyToMinor(expense.pagado_acumulado.toString());
      const remainingMinor = totalMinor - currentPaidMinor;

      if (payMinor > remainingMinor) {
        throw new GovernedExpenseWriteServiceError(
          `El monto a pagar (${treasuryMinorToMoney(payMinor)}) excede el saldo pendiente (${treasuryMinorToMoney(remainingMinor)}).`
        );
      }

      const newPaidMinor = currentPaidMinor + payMinor;
      const newState = newPaidMinor >= totalMinor ? "PAGADO" : "PARCIAL";
      const businessDate = await this.profiles.businessDateForInstant(tx, gymId, now);

      if (input.cuenta_id) {
        const account = await tx.cuenta.findFirst({
          where: {
            cuenta_id: input.cuenta_id,
            gym_id: gymId,
            is_deleted: false,
          },
          select: { moneda_id: true, tipo_pago_id: true },
        });
        if (
          !account ||
          account.moneda_id !== expense.moneda_id ||
          (input.tipo_pago_id &&
            account.tipo_pago_id &&
            account.tipo_pago_id !== input.tipo_pago_id)
        ) {
          throw new GovernedExpenseWriteServiceError(
            "La cuenta de salida no pertenece al gimnasio o no corresponde a la moneda/método del gasto.",
          );
        }
      }

      const aplicacionId = `app_${randomUUID()}`;

      // Record treasury ledger movement (cash outflow)
      const movement = await this.treasuryLedger.recordGastoGobernadoInTx(tx, gymId, {
        aplicacion_id: aplicacionId,
        gasto_id: expense.gasto_id,
        moneda_id: expense.moneda_id,
        cuenta_id: input.cuenta_id ?? null,
        tipo_pago_id: input.tipo_pago_id ?? null,
        monto: treasuryMinorToMoney(payMinor),
        fecha_negocio: businessDate,
        descripcion: `Pago de gasto: ${expense.descripcion}`,
      });

      const appRow = await tx.gastoGobernadoAplicacion.create({
        data: {
          aplicacion_id: aplicacionId,
          gasto_id: expense.gasto_id,
          movimiento_id: movement.movimiento_id,
          monto_aplicado: treasuryMinorToMoney(payMinor),
          estado: "APLICADA",
          aplicada_at: now,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          gym_id: gymId,
          source_device: DEVICE_ID,
          version: 1,
        },
      });

      const updatedExpense = await tx.gastoGobernado.update({
        where: { gasto_id: expense.gasto_id },
        data: {
          pagado_acumulado: treasuryMinorToMoney(newPaidMinor),
          estado: newState,
          fecha_pago: businessDate,
          comprobante_referencia: input.comprobante_referencia ?? expense.comprobante_referencia,
          updated_at: now,
          version: expense.version + 1,
        },
      });

      await this.recordSync(
        tx,
        "gasto_gobernado_aplicacion",
        "INSERT",
        gymId,
        appRow.aplicacion_id,
        appRow,
      );
      await this.recordSync(
        tx,
        "gasto_gobernado",
        "UPDATE",
        gymId,
        updatedExpense.gasto_id,
        updatedExpense,
      );

      return {
        expense: updatedExpense,
        application: appRow,
        movement,
      };
    });
  }

  async reversePayment(gymId: string, input: ReverseGovernedExpensePaymentInput) {
    const motivo = input.motivo.trim();
    if (!motivo) {
      throw new GovernedExpenseWriteServiceError("El motivo de la reversión es obligatorio.");
    }
    const now = trustedClock.nowUtc();

    return prisma.$transaction(async (tx: Tx) => {
      const appRow = await tx.gastoGobernadoAplicacion.findFirst({
        where: { aplicacion_id: input.aplicacion_id, gym_id: gymId, is_deleted: false },
      });
      if (!appRow) {
        throw new GovernedExpenseWriteServiceError("La aplicación de pago especificada no existe.");
      }
      if (appRow.estado === "REVERSADA") {
        throw new GovernedExpenseWriteServiceError("Esta aplicación de pago ya se encuentra reversada.");
      }

      const expense = await tx.gastoGobernado.findFirst({
        where: { gasto_id: appRow.gasto_id, gym_id: gymId, is_deleted: false },
      });
      if (!expense) {
        throw new GovernedExpenseWriteServiceError("El gasto asociado no existe.");
      }

      const originalMovement = await tx.tesoreriaMovimiento.findFirst({
        where: {
          movimiento_id: appRow.movimiento_id,
          gym_id: gymId,
          is_deleted: false,
        },
      });
      if (!originalMovement || originalMovement.moneda_id !== expense.moneda_id) {
        throw new GovernedExpenseWriteServiceError(
          "El movimiento original del pago no existe o no coincide con la moneda del gasto.",
          409,
        );
      }

      const currentPaidMinor = treasuryMoneyToMinor(expense.pagado_acumulado.toString());
      const appMinor = treasuryMoneyToMinor(appRow.monto_aplicado.toString());
      const newPaidMinor = currentPaidMinor > appMinor ? currentPaidMinor - appMinor : 0n;

      const totalMinor = treasuryMoneyToMinor(expense.monto.toString());
      let newState = "PENDIENTE";
      if (newPaidMinor > 0n && newPaidMinor < totalMinor) {
        newState = "PARCIAL";
      } else if (newPaidMinor >= totalMinor) {
        newState = "PAGADO";
      }

      const businessDate = await this.profiles.businessDateForInstant(tx, gymId, now);

      // Record counter-movement in treasury
      const movement = await this.treasuryLedger.recordGastoGobernadoReversalInTx(tx, gymId, {
        gasto_id: expense.gasto_id,
        aplicacion_id: appRow.aplicacion_id,
        moneda_id: expense.moneda_id,
        cuenta_id: originalMovement.cuenta_id,
        tipo_pago_id: originalMovement.tipo_pago_id,
        monto: treasuryMinorToMoney(appMinor),
        fecha_negocio: businessDate,
        motivo,
        descripcion: `Reversión de pago de gasto: ${expense.descripcion} (${motivo})`,
      });

      const updatedApp = await tx.gastoGobernadoAplicacion.update({
        where: { aplicacion_id: appRow.aplicacion_id },
        data: {
          estado: "REVERSADA",
          updated_at: now,
          version: appRow.version + 1,
        },
      });

      const updatedExpense = await tx.gastoGobernado.update({
        where: { gasto_id: expense.gasto_id },
        data: {
          pagado_acumulado: treasuryMinorToMoney(newPaidMinor),
          estado: newState,
          fecha_pago: newPaidMinor > 0n ? expense.fecha_pago : null,
          updated_at: now,
          version: expense.version + 1,
        },
      });

      await this.recordSync(
        tx,
        "gasto_gobernado_aplicacion",
        "UPDATE",
        gymId,
        updatedApp.aplicacion_id,
        updatedApp,
      );
      await this.recordSync(
        tx,
        "gasto_gobernado",
        "UPDATE",
        gymId,
        updatedExpense.gasto_id,
        updatedExpense,
      );

      return {
        expense: updatedExpense,
        application: updatedApp,
        reversalMovement: movement,
      };
    });
  }

  private async recordSync(
    tx: Tx,
    entity: string,
    operation: "INSERT" | "UPDATE",
    gymId: string,
    entityId: string,
    row: unknown,
  ) {
    await tx.syncLog.create({
      data: {
        event_id: randomUUID(),
        entidad: entity,
        operacion: operation,
        entidad_id: entityId,
        gym_id: gymId,
        device_id: DEVICE_ID,
        payload_json: JSON.stringify(serialize(row)),
      },
    });
  }
}
