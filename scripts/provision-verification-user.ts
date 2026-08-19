/**
 * Aprovisiona una cuenta administrativa desechable para recorridos HTTP de la
 * API remota. No usa ni modifica la cuenta del dueño.
 *
 * La identidad es deliberadamente remota: `LocalUser` autentica el escritorio
 * y esta cuenta autentica la web/API central. Se retira con `--remove` cuando
 * termina la verificación.
 *
 * Uso:
 *   REMOTE_VERIFY_PASSWORD='...' bun run provision:verification-user
 *   bun run provision:verification-user -- --remove
 *
 * **`REMOTE_VERIFY_PASSWORD` es obligatorio para aprovisionar**, sin valor por
 * defecto y en cualquier entorno.
 *
 * Antes había uno —`verificacion-admin-2026`— y solo se exigía la variable
 * cuando `NODE_ENV === "production"`. Este repositorio es **público**, así que
 * esa clave era legible por cualquiera: bastaba con que alguien ejecutara el
 * script sin la variable, en una máquina alcanzable, para dejar una cuenta de
 * administración con contraseña conocida. La comodidad no compensaba.
 *
 * Retirar la cuenta (`--remove`) **no** pide la contraseña: si retirarla
 * costara un secreto, la cuenta se quedaría puesta el día que se pierda.
 */
import bcrypt from "bcryptjs";
import { trustedClock } from "../src/config/trusted-clock";
import { usuarioSedeId } from "../src/application/auth/usuario-sede";
import { prisma } from "../src/infrastructure/db/prismaClient";

const GYM_ID = process.env.REMOTE_VERIFY_GYM_ID ?? "local-gym-001";
const USER_ID = process.env.REMOTE_VERIFY_USER_ID ?? "remote-verification-admin";
const EMAIL = process.env.REMOTE_VERIFY_EMAIL ?? "verificacion.admin@gym.test";
const MEMBERSHIP_ID = usuarioSedeId(USER_ID, GYM_ID);

/** La que se retiró al hacer obligatoria la variable; no vuelve por la puerta de atrás. */
const CLAVE_RETIRADA = "verificacion-admin-2026";

/**
 * La contraseña se resuelve **aquí y no al cargar el módulo**, para que
 * `--remove` siga funcionando sin ella.
 */
function exigirPassword(): string {
  const password = process.env.REMOTE_VERIFY_PASSWORD;
  if (!password || !password.trim()) {
    throw new Error(
      "REMOTE_VERIFY_PASSWORD es obligatorio para aprovisionar la cuenta de " +
        "verificación. No hay valor por defecto: este repositorio es público y " +
        "una clave escrita aquí la puede leer cualquiera.\n" +
        "  REMOTE_VERIFY_PASSWORD='...' bun run provision:verification-user\n" +
        "Retirar la cuenta no la necesita: " +
        "bun run provision:verification-user -- --remove",
    );
  }
  if (password === CLAVE_RETIRADA) {
    throw new Error(
      `REMOTE_VERIFY_PASSWORD no puede ser «${CLAVE_RETIRADA}»: es la clave que ` +
        "se retiró precisamente por estar publicada en este repositorio.",
    );
  }
  return password;
}

/**
 * Retira la cuenta **y hace que la baja viaje**.
 *
 * Antes borraba en duro y en silencio, y eso dejaba una cuenta viva en cada
 * sede. La secuencia que lo produce es corriente: se aprovisiona (sin evento),
 * se le concede el nivel de Dueño con `grant:dueno` —que **sí** emite—, y esa
 * cuenta baja a los SQLite de las instalaciones. Al retirarla aquí, allí no se
 * enteraba nadie: quedaba una cuenta administrativa **activa y con autoridad de
 * cadena** en la base de cada sede, y las dos bases dejaban de decir lo mismo.
 *
 * Por eso la baja es lógica y no física. Un borrado físico aquí tampoco podría
 * converger: la sincronización expresa bajas lógicas, así que la sede se
 * quedaría con la fila marcada y el concentrador sin fila, que es otra
 * divergencia. Marcada en las dos, las dos dicen lo mismo. Reaprovisionar
 * después la revive, que es lo que ya hacía la rama de reparación.
 *
 * El evento viaja como `UPDATE` y no como `DELETE` a propósito: el receptor
 * aplica un `DELETE` con `softDeleteData`, que copia **solo** las columnas de la
 * baja. La cuenta se quedaba marcada como borrada pero con `active` y
 * `es_plataforma` todavía en `1` en la sede, y la huella lo marcaba divergente.
 * Con `UPDATE` viaja la fila entera y se apagan las dos banderas allí también,
 * que es lo que se quería: si algún día alguien la reviviera a mano, no
 * revivirá con autoridad de cadena.
 */
async function remove() {
  const now = trustedClock.nowUtc();
  const result = await prisma.$transaction(async (tx) => {
    const membership = await tx.usuarioSede.findFirst({
      where: {
        usuario_sede_id: MEMBERSHIP_ID,
        user_id: USER_ID,
        gym_id: GYM_ID,
        source_device: "REMOTE_VERIFICATION",
        is_deleted: false,
      },
    });
    if (membership) {
      const fila = await tx.usuarioSede.update({
        where: { usuario_sede_id: MEMBERSHIP_ID },
        data: {
          activo: false,
          is_deleted: true,
          deleted_at: now,
          version: membership.version + 1,
          updated_at: now,
        },
      });
      await emitirCambio(tx, "usuario_sede", fila.usuario_sede_id, fila);
    }

    const user = await tx.user.findFirst({
      where: {
        user_id: USER_ID,
        user_email: EMAIL,
        source_device: "REMOTE_VERIFICATION",
        is_deleted: false,
      },
    });
    if (user) {
      const fila = await tx.user.update({
        where: { user_id: USER_ID },
        data: {
          active: false,
          es_plataforma: false,
          is_deleted: true,
          deleted_at: now,
          version: user.version + 1,
          updated_at: now,
        },
      });
      await emitirCambio(tx, "user", fila.user_id, fila);
    }
    return { memberships: membership ? 1 : 0, users: user ? 1 : 0 };
  });
  console.log(
    `Cuenta remota de verificación retirada · usuarios ${result.users} · ` +
      `asignaciones ${result.memberships}. La baja viaja a las sedes por la cola.`,
  );
}

/**
 * Publica el cambio para que las instalaciones lo vean.
 *
 * El ámbito no es el mismo para las dos entidades y confundirlo deja el evento
 * en el limbo:
 *
 * - `user` viaja **global** (`gym_id: null`), igual que en `grant:dueno`: la
 *   cuenta llega a todas las instalaciones, así que su baja también.
 * - `usuario_sede` viaja **con su sede**, como lo emite M2
 *   (`usuario-sede.controller`). Mandarlo global no lo hace llegar a más
 *   sitios: no está entre las entidades de alcance global, así que la descarga
 *   —que filtra por sede o por esa lista— no lo entrega a nadie. Se probó, y el
 *   evento se quedó sin dueño mientras el concentrador daba la fila por
 *   comunicada.
 *
 * Siempre `UPDATE` con la fila completa, incluso para dar de baja. Un `DELETE`
 * lo aplica el receptor con `softDeleteData`, que copia solo las columnas del
 * borrado: la cuenta se quedaba marcada como borrada pero con `active` y
 * `es_plataforma` todavía en `1` en la sede, y la huella lo marcaba divergente.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function emitirCambio(tx: any, entidad: "user" | "usuario_sede", entidadId: string, fila: any) {
  await tx.syncLog.create({
    data: {
      event_id: crypto.randomUUID(),
      entidad,
      operacion: "UPDATE",
      entidad_id: entidadId,
      gym_id: entidad === "usuario_sede" ? GYM_ID : null,
      payload_json: JSON.stringify(fila),
    },
  });
}

async function provision() {
  // Falla cerrada antes de tocar la base: si no hay contraseña declarada, no
  // se crea ni se repara nada. Ya no depende de `NODE_ENV`.
  const PASSWORD = exigirPassword();

  const gym = await prisma.gym.findFirst({
    where: { gym_id: GYM_ID, activo: true, deleted_at: null },
    select: { gym_id: true, nombre: true },
  });
  if (!gym) throw new Error(`No existe una sede activa con id ${GYM_ID}.`);

  const conflict = await prisma.user.findFirst({
    where: {
      OR: [
        { user_id: USER_ID, NOT: { user_email: EMAIL } },
        { user_email: EMAIL, NOT: { user_id: USER_ID } },
      ],
    },
    select: { user_id: true, user_email: true },
  });
  if (conflict) {
    throw new Error(
      "La identidad de verificación entra en conflicto con una cuenta existente; " +
        "no se sobrescribió nada.",
    );
  }

  const [existingUser, existingMembership] = await Promise.all([
    prisma.user.findUnique({ where: { user_id: USER_ID } }),
    prisma.usuarioSede.findUnique({ where: { usuario_sede_id: MEMBERSHIP_ID } }),
  ]);
  const passwordMatches = existingUser
    ? await bcrypt.compare(PASSWORD, existingUser.password)
    : false;
  const userNeedsWrite =
    !existingUser ||
    existingUser.user_nombre !== "Verificación remota" ||
    existingUser.user_email !== EMAIL ||
    !passwordMatches ||
    existingUser.role !== "admin" ||
    !existingUser.active ||
    existingUser.is_deleted ||
    existingUser.gym_id !== GYM_ID ||
    existingUser.es_plataforma ||
    existingUser.deleted_at !== null;
  const membershipNeedsWrite =
    !existingMembership ||
    existingMembership.user_id !== USER_ID ||
    existingMembership.gym_id !== GYM_ID ||
    existingMembership.rol !== "admin" ||
    !existingMembership.activo ||
    existingMembership.is_deleted ||
    existingMembership.deleted_at !== null;
  const now = trustedClock.nowUtc();
  const passwordHash = userNeedsWrite
    ? await bcrypt.hash(PASSWORD, 10)
    : existingUser!.password;
  // El alta se publica igual que la baja. Antes no emitía nada, y la cuenta solo
  // llegaba a las sedes por el evento de `grant:dueno`: la asignación de sede no
  // llegaba nunca, así que el concentrador tenía una fila que ninguna
  // instalación conocía —y su baja después no tenía a qué aplicarse—.
  await prisma.$transaction(async (tx) => {
    if (!existingUser) {
      const fila = await tx.user.create({
        data: {
          user_id: USER_ID,
          user_nombre: "Verificación remota",
          user_email: EMAIL,
          password: passwordHash,
          role: "admin",
          active: true,
          is_deleted: false,
          gym_id: GYM_ID,
          es_plataforma: false,
          source_device: "REMOTE_VERIFICATION",
          version: 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      });
      await emitirCambio(tx, "user", fila.user_id, fila);
    } else if (userNeedsWrite) {
      const fila = await tx.user.update({
        where: { user_id: USER_ID },
        data: {
          user_nombre: "Verificación remota",
          user_email: EMAIL,
          password: passwordHash,
          role: "admin",
          active: true,
          is_deleted: false,
          gym_id: GYM_ID,
          es_plataforma: false,
          source_device: "REMOTE_VERIFICATION",
          version: { increment: 1 },
          updated_at: now,
          deleted_at: null,
        },
      });
      await emitirCambio(tx, "user", fila.user_id, fila);
    }
    if (!existingMembership) {
      const fila = await tx.usuarioSede.create({
        data: {
          usuario_sede_id: MEMBERSHIP_ID,
          user_id: USER_ID,
          gym_id: GYM_ID,
          rol: "admin",
          activo: true,
          source_device: "REMOTE_VERIFICATION",
          version: 1,
          is_deleted: false,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      });
      await emitirCambio(tx, "usuario_sede", fila.usuario_sede_id, fila);
    } else if (membershipNeedsWrite) {
      const fila = await tx.usuarioSede.update({
        where: { usuario_sede_id: MEMBERSHIP_ID },
        data: {
          rol: "admin",
          activo: true,
          source_device: "REMOTE_VERIFICATION",
          version: { increment: 1 },
          is_deleted: false,
          updated_at: now,
          deleted_at: null,
        },
      });
      await emitirCambio(tx, "usuario_sede", fila.usuario_sede_id, fila);
    }
  });

  console.log(`Cuenta remota de verificación lista para ${gym.nombre} (${gym.gym_id}).`);
  console.log(`Email: ${EMAIL}`);
  // La contraseña ya no se imprime. Antes era una constante conocida y daba
  // igual; ahora es un secreto del operador, y la salida de estos guiones
  // acaba redirigida a ficheros de evidencia.
  console.log("Password: la declarada en REMOTE_VERIFY_PASSWORD.");
  console.log("Rol: admin · plataforma: no");
  console.log(
    userNeedsWrite || membershipNeedsWrite
      ? "Estado: aprovisionada o reparada."
      : "Estado: ya estaba lista; no se modificó ninguna fila.",
  );
}

try {
  if (process.argv.includes("--remove")) await remove();
  else await provision();
} finally {
  await prisma.$disconnect();
}
