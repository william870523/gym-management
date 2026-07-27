import { describe, expect, test } from "bun:test";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";
import type {
  SyncLogRecord,
  SyncLogRepository,
} from "../../../domain/repositories/SyncLogRepository";
import { DeleteCuentaUseCase } from "./DeleteCuentaUseCase";
import { GetCuentaUseCase } from "./GetCuentaUseCase";
import { ListCuentasUseCase } from "./ListCuentasUseCase";
import { UpdateCuentaUseCase } from "./UpdateCuentaUseCase";

class MemoryAccounts implements CuentaRepository {
  constructor(readonly rows: Cuenta[]) {}

  // Doble en memoria: no hay transacción, así que la variante transaccional
  // es el mismo repositorio.
  withTransaction(): this {
    return this;
  }

  async upsertCuenta(data: Cuenta) {
    const index = this.rows.findIndex((row) => row.cuenta_id === data.cuenta_id);
    if (index >= 0) this.rows[index] = data;
    else this.rows.push(data);
  }

  async findAll(gymId: string) {
    return this.rows.filter((row) => row.gym_id === gymId && !row.is_deleted);
  }

  async findById(id: string, gymId: string) {
    return this.rows.find(
      (row) => row.cuenta_id === id && row.gym_id === gymId && !row.is_deleted,
    ) ?? null;
  }

  async create(data: Cuenta, gymId: string) {
    this.rows.push({ ...data, gym_id: gymId });
  }

  async update(id: string, gymId: string, data: Partial<Cuenta>) {
    const row = await this.findById(id, gymId);
    if (row) Object.assign(row, data);
  }

  async softDelete(id: string, gymId: string) {
    const row = await this.findById(id, gymId);
    if (row) row.is_deleted = true;
  }
}

class MemorySyncLog implements SyncLogRepository {
  records: SyncLogRecord[] = [];
  async exists() { return false; }
  async register(record: SyncLogRecord) { this.records.push(record); }
  async findChanges() { return []; }
}

const account = (id: string, gymId: string): Cuenta => ({
  cuenta_id: id,
  nombre_cuenta: `Cuenta ${id}`,
  moneda_id: "currency",
  tipo_pago_id: null,
  gym_id: gymId,
  source_device: "device",
  version: 1,
  is_deleted: false,
});

describe("account gym scope", () => {
  test("lista y consulta únicamente el gimnasio solicitado", async () => {
    const repository = new MemoryAccounts([
      account("own", "gym-a"),
      account("foreign", "gym-b"),
    ]);
    const list = new ListCuentasUseCase(repository);
    const get = new GetCuentaUseCase(repository);

    expect((await list.execute("gym-a")).map((row) => row.cuenta_id)).toEqual([
      "own",
    ]);
    expect(await get.execute("foreign", "gym-a")).toBeNull();
  });

  test("edición y baja no cruzan el gimnasio del JWT", async () => {
    const foreign = account("foreign", "gym-b");
    const repository = new MemoryAccounts([foreign]);
    const syncLog = new MemorySyncLog();
    const update = new UpdateCuentaUseCase(repository, syncLog);
    const remove = new DeleteCuentaUseCase(repository, syncLog);

    await expect(
      update.execute("foreign", { nombre_cuenta: "Alterada" }, "gym-a"),
    ).rejects.toThrow("Cuenta not found");
    await expect(remove.execute("foreign", "gym-a")).rejects.toThrow(
      "Cuenta not found",
    );
    expect(foreign.nombre_cuenta).toBe("Cuenta foreign");
    expect(foreign.is_deleted).toBeFalse();
    expect(syncLog.records).toHaveLength(0);
  });
});
