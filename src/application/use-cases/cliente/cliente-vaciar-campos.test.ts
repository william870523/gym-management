import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { PrismaClienteRepository } from "../../../infrastructure/repositories/PrismaClienteRepository";
import { UpdateClienteUseCase } from "./UpdateClienteUseCase";
import { trustedClock } from "../../../config/trusted-clock";

/**
 * Defecto vecino del 10-08-2026: **desde la web no se podía vaciar un campo**.
 *
 * `PrismaClienteRepository.update` hacía `direccion: data.direccion ?? undefined`
 * —y lo mismo con teléfono, correo, objetivo, entrenador y referencia—, así que
 * un `null` explícito se convertía en «no tocar». Desde el escritorio sí se
 * vaciaba: el camino local vuelca los campos que vengan, incluidos los nulos.
 *
 * No es cosmético. El remoto existe para que el gimnasio siga trabajando el día
 * que falle el escritorio (`CLAUDE.md`), y ese día no podía ni borrar un
 * teléfono equivocado.
 *
 * `undefined` sigue significando «no me lo mandaron»: la otra mitad del contrato
 * es no pisar lo que nadie tocó, y también está probada aquí.
 */
describe("cliente · vaciar un campo desde la web", () => {
  const gymId = "local-gym-001";
  const CI = "CVC000000001";

  let nationalityId = "";
  let trainerId = "";
  let referenceId = "";

  const repo = () => new PrismaClienteRepository();
  const syncLogEspia = { async register() {} } as any;
  const editar = (dto: Record<string, unknown>) =>
    new UpdateClienteUseCase(repo(), syncLogEspia).execute(CI, dto as any, gymId, {
      userId: null,
      role: "admin",
    });
  const leer = () => prisma.cliente.findUnique({ where: { ci: CI } });

  async function sembrar() {
    await prisma.cliente.deleteMany({ where: { ci: CI } });
    const now = trustedClock.nowUtc();
    await prisma.cliente.create({
      data: {
        ci: CI,
        tipo_documento: "OTRO",
        nombres: "Socio",
        apellidos: "Con Campos Llenos",
        sexo: "Femenino",
        estatura_cliente: 170,
        nacionalidad_id: nationalityId,
        direccion: "Calle 1 #2",
        telefono: 55500001,
        correo: "cvc@socio.test",
        objetivo: "Ganar masa",
        id_entrenador: trainerId,
        referencia_id: referenceId,
        foto_cliente: Buffer.from([1, 2, 3]),
        fecha_inicio: now,
        fecha_fin: new Date(now.getTime() + 30 * 86400000),
        activo: true,
        categoria: "NUEVO",
        is_deleted: false,
        gym_id: gymId,
        version: 1,
        created_at: now,
        updated_at: now,
      } as any,
    });
  }

  beforeAll(async () => {
    const [nationality, trainer, reference] = await Promise.all([
      prisma.nacionalidad.findFirst({
        where: { is_deleted: false },
        orderBy: { nacionalidad_id: "asc" },
      }),
      prisma.entrenador.findFirst({
        where: { gym_id: gymId, is_deleted: false, activo_entrenador: true },
        orderBy: { id_entrenador: "asc" },
      }),
      prisma.referencia.findFirst({
        where: { is_deleted: false },
        orderBy: { referencia_id: "asc" },
      }),
    ]);
    if (!nationality || !trainer || !reference) {
      throw new Error("Faltan catálogos base (nacionalidad/entrenador/referencia).");
    }
    nationalityId = nationality.nacionalidad_id;
    trainerId = trainer.id_entrenador;
    referenceId = reference.referencia_id;
  });

  afterAll(async () => {
    await prisma.cliente.deleteMany({ where: { ci: CI } });
  });

  /**
   * Eran seis; son cinco desde el 12-08-2026.
   *
   * `id_entrenador` salió de la lista: quitarle el entrenador a un socio no es
   * vaciar un dato personal, es una condición del contrato. Tiene su flujo
   * formal —`POST /membresias/:id/cambiar-entrenador`, que además **libera el
   * tramo futuro de comisión**— y hacerlo desde la ficha dejaba las cuotas
   * colgando del entrenador que salía. El arreglo del 10-08 acertó en el
   * mecanismo (un null vacía, no significa «no tocar») y se llevó por delante un
   * campo que no era personal.
   */
  test("un null explícito vacía el campo, en los cinco personales", async () => {
    await sembrar();
    await editar({
      direccion: null,
      telefono: null,
      correo: null,
      objetivo: null,
      referencia_id: null,
    });

    const fila = await leer();
    expect(fila?.direccion).toBeNull();
    expect(fila?.telefono).toBeNull();
    expect(fila?.correo).toBeNull();
    expect(fila?.objetivo).toBeNull();
    expect(fila?.referencia_id).toBeNull();
  });

  test("quitar el entrenador desde la ficha se rechaza y dice por dónde", async () => {
    await sembrar();

    await expect(editar({ id_entrenador: null })).rejects.toThrow(
      /Cambiar entrenador/,
    );
  });

  test("lo que no viene no se toca: editar el teléfono no borra la dirección", async () => {
    await sembrar();
    await editar({ telefono: 55599999 });

    const fila = await leer();
    expect(Number(fila?.telefono)).toBe(55599999);
    expect(fila?.direccion).toBe("Calle 1 #2");
    expect(fila?.correo).toBe("cvc@socio.test");
    expect(fila?.objetivo).toBe("Ganar masa");
    expect(fila?.id_entrenador).toBe(trainerId);
  });

  test("la foto se vacía con null, y una cadena vacía la deja como está", async () => {
    await sembrar();

    await editar({ foto_cliente: "" });
    expect((await leer())?.foto_cliente).not.toBeNull();

    await editar({ foto_cliente: null });
    expect((await leer())?.foto_cliente).toBeNull();
  });

  test("cada edición mueve la versión, aunque solo vacíe un campo", async () => {
    await sembrar();
    expect((await leer())?.version).toBe(1);

    await editar({ direccion: null });
    expect((await leer())?.version).toBe(2);

    await editar({ objetivo: null });
    expect((await leer())?.version).toBe(3);
  });
});
