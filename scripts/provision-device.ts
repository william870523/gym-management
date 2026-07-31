/**
 * Aprovisiona el dispositivo de una sede en la base remota.
 *
 * Es la identidad con la que la cola de sincronización del escritorio entra al
 * remoto: `sync-worker.ts` pide un token a `POST /auth/device-login` con
 * `DEVICE_ID` y `DEVICE_SECRET` del `.env` local, y `LoginDeviceUseCase` exige
 * que la fila exista en `device` con ese `secret_key` y activa.
 *
 * **No hay endpoint que registre dispositivos**: se aprovisionan fuera de banda,
 * y por eso esto es un script y no una llamada HTTP. Es infraestructura de la
 * instalación, no dato de negocio.
 *
 * Uso:
 *   DEVICE_ID=device-001 DEVICE_SECRET=... DEVICE_GYM_ID=local-gym-001 \
 *     bun run provision:device
 *
 * Sin variables toma los mismos valores que trae el `.env` del escritorio.
 */
import { prisma } from "../src/infrastructure/db/prismaClient";

const deviceId = process.env.DEVICE_ID ?? "device-001";
const secret = process.env.DEVICE_SECRET ?? "mock-device-token";
const gymId = process.env.DEVICE_GYM_ID ?? "local-gym-001";
const nombre = process.env.DEVICE_NOMBRE ?? "Escritorio de la sede";

try {
  const sede = await prisma.gym.findUnique({
    where: { gym_id: gymId },
    select: { gym_id: true, nombre: true },
  });
  if (!sede) {
    throw new Error(
      `No existe la sede ${gymId}: el dispositivo cuelga de ella por clave foránea.`,
    );
  }

  const resultado = await prisma.device.upsert({
    where: { device_id: deviceId },
    update: {
      gym_id: gymId,
      nombre,
      secret_key: secret,
      is_active: true,
      deleted_at: null,
      updated_at: new Date(),
    },
    create: {
      device_id: deviceId,
      gym_id: gymId,
      nombre,
      tipo: "BACKEND_OFFLINE",
      secret_key: secret,
      is_active: true,
    },
  });

  console.log(
    `Dispositivo aprovisionado: ${resultado.device_id} → sede ${sede.gym_id} ` +
      `(${sede.nombre}), activo=${resultado.is_active}.`,
  );
} finally {
  await prisma.$disconnect();
}
