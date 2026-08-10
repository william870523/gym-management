/**
 * Aprovisiona una cuenta administrativa desechable para recorridos HTTP de la
 * API remota. No usa ni modifica la cuenta del dueño.
 *
 * La identidad es deliberadamente remota: `LocalUser` autentica el escritorio
 * y esta cuenta autentica la web/API central. Se retira con `--remove` cuando
 * termina la verificación.
 *
 * Uso:
 *   bun run provision:verification-user
 *   bun run provision:verification-user -- --remove
 *
 * En producción no existe contraseña predeterminada: hay que declarar
 * `REMOTE_VERIFY_PASSWORD` expresamente.
 */
import bcrypt from "bcryptjs";
import { trustedClock } from "../src/config/trusted-clock";
import { usuarioSedeId } from "../src/application/auth/usuario-sede";
import { prisma } from "../src/infrastructure/db/prismaClient";

const GYM_ID = process.env.REMOTE_VERIFY_GYM_ID ?? "local-gym-001";
const USER_ID = process.env.REMOTE_VERIFY_USER_ID ?? "remote-verification-admin";
const EMAIL = process.env.REMOTE_VERIFY_EMAIL ?? "verificacion.admin@gym.test";
const DEFAULT_DEV_PASSWORD = "verificacion-admin-2026";
const PASSWORD = process.env.REMOTE_VERIFY_PASSWORD ?? DEFAULT_DEV_PASSWORD;
const MEMBERSHIP_ID = usuarioSedeId(USER_ID, GYM_ID);

async function remove() {
  const result = await prisma.$transaction(async (tx) => {
    const membership = await tx.usuarioSede.deleteMany({
      where: {
        usuario_sede_id: MEMBERSHIP_ID,
        user_id: USER_ID,
        gym_id: GYM_ID,
        source_device: "REMOTE_VERIFICATION",
      },
    });
    const user = await tx.user.deleteMany({
      where: {
        user_id: USER_ID,
        user_email: EMAIL,
        source_device: "REMOTE_VERIFICATION",
      },
    });
    return { memberships: membership.count, users: user.count };
  });
  console.log(
    `Cuenta remota de verificación retirada · usuarios ${result.users} · ` +
      `asignaciones ${result.memberships}.`,
  );
}

async function provision() {
  if (process.env.NODE_ENV === "production" && !process.env.REMOTE_VERIFY_PASSWORD) {
    throw new Error(
      "En producción REMOTE_VERIFY_PASSWORD es obligatorio; no se usa la clave de desarrollo.",
    );
  }

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
  await prisma.$transaction(async (tx) => {
    if (!existingUser) {
      await tx.user.create({
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
    } else if (userNeedsWrite) {
      await tx.user.update({
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
    }
    if (!existingMembership) {
      await tx.usuarioSede.create({
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
    } else if (membershipNeedsWrite) {
      await tx.usuarioSede.update({
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
    }
  });

  console.log(`Cuenta remota de verificación lista para ${gym.nombre} (${gym.gym_id}).`);
  console.log(`Email: ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
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
