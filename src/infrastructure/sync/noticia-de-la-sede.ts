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
