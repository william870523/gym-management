/**
 * M5 — cuándo se supo por última vez de una sede.
 *
 * El semáforo de cierre (docs/MULTI_SEDE.md §6.2) distingue «no ha cerrado» de
 * «no sabemos nada de ella», y esa distinción vale exactamente lo que valga
 * esta marca: si la marca no se actualiza, una sede conectada acaba pareciendo
 * incomunicada.
 *
 * ## El agujero que esto tapa
 *
 * `sync_client_state` solo lo tocaba la **subida**, y la subida se corta antes
 * de salir a la red cuando el outbox está vacío (`sync-worker.uploadPendingEvents`
 * devuelve sin llamar si no hay eventos). Una sede que estuvo tranquila —sin
 * altas ni cobros— sigue bajando cambios cada ciclo y no sube ninguno, así que
 * no dejaba rastro alguno. Con el semáforo delante eso se convierte en un error
 * caro y silencioso: la sede aparecería `SIN_NOTICIAS`, el administrador iría a
 * mirar una conexión que funciona, y el consolidado quedaría sin firmar por una
 * sede que estaba al habla.
 *
 * La bajada, en cambio, ocurre **siempre** que la instalación está viva. Es la
 * señal honesta de que esa sede sigue hablando con el concentrador.
 *
 * Recibe el cliente por parámetro para poder probarlo sin base delante.
 */

/** Las tres columnas de `sync_client_state`, ni una más. */
export interface MarcaDeNoticia {
  readonly last_upload_at?: Date;
  readonly last_server_sync_at?: Date;
  readonly last_seen_at?: Date;
}

export interface ClienteDeNoticias {
  readonly syncClientState: {
    upsert(args: {
      where: { device_id: string };
      create: MarcaDeNoticia & { device_id: string };
      update: MarcaDeNoticia;
    }): Promise<unknown>;
  };
}

/** Qué hizo la instalación: bajar cambios o subir los suyos. */
export type MotivoDeNoticia = "BAJADA" | "SUBIDA";

/**
 * Anota que se ha sabido de ese dispositivo.
 *
 * Nunca lanza: es telemetría, y perder una marca es molesto pero perder la
 * sincronización por no poder anotarla sería mucho peor. Devuelve si se anotó,
 * para que quien quiera comprobarlo pueda.
 */
export async function registrarNoticiaDeLaSede(
  db: ClienteDeNoticias,
  input: {
    readonly deviceId: string;
    readonly cuando: Date;
    readonly motivo: MotivoDeNoticia;
    readonly alFallar?: (error: unknown) => void;
  },
): Promise<boolean> {
  const deviceId = String(input.deviceId ?? "").trim();
  // Sin dispositivo no hay a quién anotarle nada. Escribir con clave vacía
  // fabricaría una fila fantasma que después parecería una sede al habla.
  if (!deviceId) return false;

  const marca: MarcaDeNoticia =
    input.motivo === "SUBIDA"
      ? { last_upload_at: input.cuando, last_seen_at: input.cuando }
      : { last_server_sync_at: input.cuando, last_seen_at: input.cuando };

  try {
    await db.syncClientState.upsert({
      where: { device_id: deviceId },
      create: { device_id: deviceId, ...marca },
      update: { ...marca },
    });
    return true;
  } catch (error) {
    input.alFallar?.(error);
    return false;
  }
}

/** Lo mínimo que hace falta para leer cuándo se supo de una sede. */
export interface LectorDeNoticias {
  readonly device: {
    findMany(args: {
      where: { gym_id: string };
      select: { last_login_at: true; last_seen_at: true; device_id: true };
    }): Promise<
      Array<{
        device_id: string;
        last_login_at: Date | null;
        last_seen_at: Date | null;
      }>
    >;
  };
  readonly syncClientState: {
    findMany(args: {
      where: { device_id: { in: string[] } };
    }): Promise<
      Array<{
        device_id: string;
        last_upload_at: Date | null;
        last_server_sync_at: Date | null;
        last_seen_at: Date | null;
      }>
    >;
  };
}

/**
 * La última vez que se supo de una sede, por cualquiera de sus dispositivos.
 *
 * Mira las mismas cinco marcas que el semáforo de M5 —`device.last_login_at`,
 * `device.last_seen_at` y las tres de `sync_client_state`— y se queda con la
 * más reciente. Usar solo una daría falsos silencios: la subida no se llama
 * cuando no hay nada que subir, y una sede tranquila parecería incomunicada.
 *
 * `null` significa **no consta**, no «lleva mucho»: una sede recién dada de
 * alta, o cuyo escritorio nunca arrancó, no ha dado noticias nunca y eso no se
 * puede convertir en un número de días.
 */
export async function ultimaNoticiaDeLaSede(
  db: LectorDeNoticias,
  gymId: string,
): Promise<Date | null> {
  const sede = String(gymId ?? "").trim();
  if (!sede) return null;

  const dispositivos = await db.device.findMany({
    where: { gym_id: sede },
    select: { device_id: true, last_login_at: true, last_seen_at: true },
  });
  if (dispositivos.length === 0) return null;

  const estados = await db.syncClientState.findMany({
    where: { device_id: { in: dispositivos.map((d) => d.device_id) } },
  });
  const porDispositivo = new Map(estados.map((e) => [e.device_id, e]));

  const marcas = dispositivos.flatMap((dispositivo) => {
    const estado = porDispositivo.get(dispositivo.device_id);
    return [
      dispositivo.last_login_at,
      dispositivo.last_seen_at,
      estado?.last_upload_at ?? null,
      estado?.last_server_sync_at ?? null,
      estado?.last_seen_at ?? null,
    ];
  });

  const vivas = marcas.filter(
    (f): f is Date => f instanceof Date && !Number.isNaN(f.getTime()),
  );
  if (vivas.length === 0) return null;
  return vivas.reduce((mayor, fecha) => (fecha > mayor ? fecha : mayor));
}
