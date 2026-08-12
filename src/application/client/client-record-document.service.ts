import type { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { resolveFrozenActor } from "../accounting/frozen-actor";

type Tx = Prisma.TransactionClient;
type DocumentFormat = "PDF" | "CSV";
type DocumentDestination = "ARCHIVO" | "IMPRESION";
const ENTITY = "cliente_expediente_documento";
const MAX_BYTES = 10 * 1024 * 1024;

export class ClientRecordDocumentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class ClientRecordDocumentService {
  async register(input: {
    gymId: string;
    clientId: string;
    operationId: unknown;
    format: unknown;
    destination: unknown;
    fileName: unknown;
    contentBase64: unknown;
    filters: unknown;
    userId: string;
  }) {
    const operationId = this.operationId(input.operationId);
    const format = this.format(input.format);
    const destination = this.destination(input.destination);
    const fileName = this.fileName(input.fileName, format);
    const content = this.content(input.contentBase64, format);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const filtersJson = this.filters(input.filters);
    const repeated = await prisma.clienteExpedienteDocumento.findUnique({
      where: { operacion_id: operationId },
    });
    if (repeated) {
      if (
        repeated.gym_id !== input.gymId ||
        repeated.ci !== input.clientId ||
        repeated.formato !== format ||
        repeated.destino !== destination ||
        repeated.sha256 !== sha256
      ) {
        throw new ClientRecordDocumentError(
          "El identificador de operación ya pertenece a otra emisión.",
          409,
        );
      }
      return this.metadata(repeated);
    }
    const nowUtc = trustedClock.nowUtc();
    let row;
    try {
      row = await prisma.$transaction(async (tx) => {
        const client = await tx.cliente.findFirst({
          where: { ci: input.clientId, gym_id: input.gymId, is_deleted: false },
          select: { ci: true },
        });
        if (!client)
          throw new ClientRecordDocumentError("El cliente no existe.", 404);
        const actor = await resolveFrozenActor(tx, {
          userId: input.userId,
          gymId: input.gymId,
        });
        const created = await tx.clienteExpedienteDocumento.create({
          data: {
            documento_id: operationId,
            operacion_id: operationId,
            ci: input.clientId,
            formato: format,
            destino: destination,
            nombre_archivo: fileName,
            mime_type:
              format === "PDF" ? "application/pdf" : "text/csv; charset=utf-8",
            contenido: content,
            tamano_bytes: content.length,
            sha256,
            filtros_json: filtersJson,
            emitido_por_user_id: actor.userId,
            emitido_por_nombre_snapshot: actor.nombre,
            emitido_por_rol_snapshot: actor.rol,
            emitido_por_origen: actor.origen,
            emitido_at: nowUtc,
            is_deleted: false,
            created_at: nowUtc,
            gym_id: input.gymId,
            source_device: null,
            version: 1,
            updated_at: nowUtc,
            deleted_at: null,
          },
        });
        await tx.syncLog.create({
          data: {
            event_id: operationId,
            entidad: ENTITY,
            operacion: "INSERT",
            entidad_id: created.documento_id,
            gym_id: input.gymId,
            payload_json: JSON.stringify(serialize(created)),
          },
        });
        return created;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const concurrent = await prisma.clienteExpedienteDocumento.findUnique({
          where: { operacion_id: operationId },
        });
        if (
          concurrent?.gym_id === input.gymId &&
          concurrent.ci === input.clientId &&
          concurrent.formato === format &&
          concurrent.destino === destination &&
          concurrent.sha256 === sha256
        ) {
          return this.metadata(concurrent);
        }
      }
      throw error;
    }
    return this.metadata(row);
  }

  async list(gymId: string, clientId: string) {
    const exists = await prisma.cliente.findFirst({
      where: { ci: clientId, gym_id: gymId, is_deleted: false },
      select: { ci: true },
    });
    if (!exists)
      throw new ClientRecordDocumentError("El cliente no existe.", 404);
    const rows = await prisma.clienteExpedienteDocumento.findMany({
      where: { gym_id: gymId, ci: clientId, is_deleted: false },
      orderBy: [{ emitido_at: "desc" }, { documento_id: "desc" }],
      take: 100,
    });
    return rows.map((row) => this.metadata(row));
  }

  async getContent(gymId: string, clientId: string, documentId: string) {
    const row = await prisma.clienteExpedienteDocumento.findFirst({
      where: {
        documento_id: documentId,
        gym_id: gymId,
        ci: clientId,
        is_deleted: false,
      },
    });
    if (!row) throw new ClientRecordDocumentError("La emisión no existe.", 404);
    return {
      ...this.metadata(row),
      contenido_base64: Buffer.from(row.contenido).toString("base64"),
    };
  }

  private metadata(row: any) {
    return {
      documento_id: row.documento_id,
      ci: row.ci,
      formato: row.formato,
      destino: row.destino,
      nombre_archivo: row.nombre_archivo,
      mime_type: row.mime_type,
      tamano_bytes: row.tamano_bytes,
      sha256: row.sha256,
      filtros: JSON.parse(row.filtros_json),
      emitido_por_user_id: row.emitido_por_user_id,
      emitido_por_nombre_snapshot: row.emitido_por_nombre_snapshot,
      emitido_por_rol_snapshot: row.emitido_por_rol_snapshot,
      emitido_por_origen: row.emitido_por_origen,
      emitido_at: row.emitido_at,
    };
  }
  private operationId(value: unknown) {
    const id = String(value ?? "").trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new ClientRecordDocumentError(
        "La operación de emisión no es válida.",
      );
    return id;
  }
  private format(value: unknown): DocumentFormat {
    const v = String(value ?? "")
      .trim()
      .toUpperCase();
    if (v !== "PDF" && v !== "CSV")
      throw new ClientRecordDocumentError("El formato debe ser PDF o CSV.");
    return v;
  }
  private destination(value: unknown): DocumentDestination {
    const v = String(value ?? "")
      .trim()
      .toUpperCase();
    if (v !== "ARCHIVO" && v !== "IMPRESION")
      throw new ClientRecordDocumentError(
        "El destino debe ser ARCHIVO o IMPRESION.",
      );
    return v;
  }
  private fileName(value: unknown, format: DocumentFormat) {
    const name = String(value ?? "").trim();
    if (!name || name.length > 180 || /[\\/\0]/.test(name))
      throw new ClientRecordDocumentError(
        "El nombre del archivo no es válido.",
      );
    if (!name.toLowerCase().endsWith(`.${format.toLowerCase()}`))
      throw new ClientRecordDocumentError(
        `El archivo debe terminar en .${format.toLowerCase()}.`,
      );
    return name;
  }
  private content(value: unknown, format: DocumentFormat) {
    const encoded = String(value ?? "").replace(/\s/g, "");
    if (
      !encoded ||
      encoded.length > Math.ceil((MAX_BYTES * 4) / 3) + 8 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    )
      throw new ClientRecordDocumentError(
        "El contenido codificado no es válido.",
      );
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > MAX_BYTES)
      throw new ClientRecordDocumentError(
        "El documento está vacío o supera 10 MiB.",
      );
    if (format === "PDF" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new ClientRecordDocumentError(
        "El contenido no corresponde a un PDF.",
      );
    if (
      format === "CSV" &&
      !bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .startsWith("cliente_ci,")
    )
      throw new ClientRecordDocumentError(
        "El contenido no corresponde al CSV del expediente.",
      );
    return bytes;
  }
  private filters(value: unknown) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new ClientRecordDocumentError(
        "Los filtros de la emisión no son válidos.",
      );
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > 4096)
      throw new ClientRecordDocumentError(
        "Los filtros de la emisión son demasiado extensos.",
      );
    return json;
  }
}
