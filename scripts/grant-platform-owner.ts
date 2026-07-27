/**
 * Concede o retira el nivel de **Dueño de la cadena** (multi-sede M1).
 *
 * Se hace con un script y no en la migración a propósito: la autoridad no se
 * regala por el hecho de migrar, se concede a una cuenta concreta y queda
 * escrito quién la tiene. Gemelo del de `gym-local-api`: **hay que ejecutarlo
 * en las dos bases**, porque el nivel debe reconocerse también al entrar desde
 * el escritorio de cualquier sede.
 *
 *   bun run grant:dueno -- --email alguien@ejemplo.com
 *   bun run grant:dueno -- --email alguien@ejemplo.com --revoke
 */
import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";

function arg(nombre: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim();
  const revocar = process.argv.includes("--revoke");
  if (!email) {
    throw new Error("Falta --email <correo de la cuenta>.");
  }

  const user = await prisma.user.findFirst({
    where: { user_email: email, is_deleted: false },
    select: {
      user_id: true,
      user_nombre: true,
      user_email: true,
      role: true,
      gym_id: true,
      active: true,
      es_plataforma: true,
      version: true,
    },
  });
  if (!user) {
    throw new Error(`No existe una cuenta vigente con el correo ${email}.`);
  }
  if (!user.active) {
    throw new Error(`La cuenta ${email} está inactiva; actívela antes.`);
  }

  console.log(
    `Antes: ${user.user_nombre} · ${user.user_email} · rol ${user.role} · ` +
      `sede por defecto ${user.gym_id ?? "(ninguna)"} · dueño de la cadena: ${user.es_plataforma}`,
  );

  const objetivo = !revocar;
  if (user.es_plataforma === objetivo) {
    console.log("Sin cambios: ya estaba así.");
    return;
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const fila = await tx.user.update({
      where: { user_id: user.user_id },
      data: {
        es_plataforma: objetivo,
        version: user.version + 1,
        updated_at: trustedClock.nowUtc(),
      },
    });
    // El evento nace con `gym_id: null` —global— para que el nivel llegue a
    // TODAS las instalaciones y no solo a la sede por defecto de la cuenta.
    //
    // Lleva la fila completa, igual que cualquier edición de usuario
    // (`UpdateUserUseCase`): si se omitiera la contraseña y la cuenta no
    // existiera todavía en la base que recibe, el alta fallaría y dejaría la
    // cola atascada, que es como se han bloqueado antes las descargas.
    await tx.syncLog.create({
      data: {
        event_id: crypto.randomUUID(),
        entidad: "user",
        operacion: "UPDATE",
        entidad_id: fila.user_id,
        gym_id: null,
        payload_json: JSON.stringify(fila),
      },
    });
    return fila;
  });

  console.log(
    `Después: ${actualizado.user_email} · dueño de la cadena: ` +
      `${actualizado.es_plataforma} · versión ${actualizado.version}`,
  );
  console.log(
    "Recuerde ejecutar el gemelo en la otra base: el nivel de Dueño debe " +
      "reconocerse en el escritorio de cualquier sede.",
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
