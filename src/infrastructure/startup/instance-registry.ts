/**
 * Registro de instancias del servidor.
 *
 * ## Por qué existe
 *
 * El 31-07-2026 había **tres APIs locales corriendo a la vez**, huérfanas de
 * sesiones anteriores. Solo una tenía el puerto 8080, pero el puerto no hace
 * falta para hacer daño: cada una arranca su propio worker de sincronización, y
 * los tres estaban escribiendo el mismo fichero SQLite y disputándose la misma
 * cola contra MariaDB. La protección `isSyncing` del worker es **de instancia**;
 * entre procesos distintos no protege nada.
 *
 * Peor: al recargar `--watch`, los tres reiniciaron a la vez y el puerto lo ganó
 * una que estaba en modo simulación. Durante cuarenta minutos la API que
 * respondía no era la que nadie creía que respondía.
 *
 * ## Qué hace
 *
 * Cada proceso escribe un fichero con su PID, su puerto y desde cuándo vive. Al
 * arrancar mira quién más está vivo:
 *
 *  - si ya hay otra instancia **del mismo servicio** respirando, la nueva puede
 *    negarse a arrancar su worker (`exigirExclusividad`), que es donde estaba el
 *    daño real;
 *  - las entradas de procesos muertos se limpian solas, para que un corte de
 *    corriente no deje el registro mintiendo para siempre.
 *
 * No se apoya en la línea de comandos del proceso: `bun --watch index.ts` es
 * idéntica en la API local y en la remota, así que por ahí no se distinguen.
 * Cada una se identifica aquí por su nombre de servicio.
 *
 * **Gemelo de `gym-local-api/src/infrastructure/startup/instance-registry.ts`.**
 * Son copia literal a propósito: el `tsconfig` de cada API solo incluye su
 * propio `src`, así que un módulo común fuera de ahí rompería el typecheck.
 * Cualquier cambio va a los dos ficheros; `instance-registry.test.ts` de ambas
 * APIs comprueba el mismo comportamiento.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";

export interface InstanciaRegistrada {
  servicio: string;
  pid: number;
  puerto: number | null;
  arrancadaEn: string;
  simulacion: boolean;
  /** Directorio desde el que se lanzó, para poder señalarla sin ambigüedad. */
  directorio: string;
}

export interface OpcionesRegistro {
  servicio: string;
  puerto?: number | null;
  simulacion?: boolean;
  /** Dónde viven los ficheros. Por defecto, `<raíz>/.runtime`. */
  directorioRegistro: string;
}

/** ¿Sigue vivo ese PID? `process.kill(pid, 0)` no mata: solo pregunta. */
export function procesoVivo(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // EPERM = existe pero es de otro usuario: vivo a estos efectos.
    return error?.code === "EPERM";
  }
}

function rutaDe(directorio: string, servicio: string, pid: number) {
  return join(directorio, `${servicio}-${pid}.json`);
}

/** Lee el registro entero, descartando de paso lo que ya no respira. */
export function listarInstancias(
  directorioRegistro: string,
  opciones: { limpiarMuertas?: boolean } = {},
): InstanciaRegistrada[] {
  if (!existsSync(directorioRegistro)) return [];
  const vivas: InstanciaRegistrada[] = [];
  for (const nombre of readdirSync(directorioRegistro)) {
    if (!nombre.endsWith(".json")) continue;
    const ruta = join(directorioRegistro, nombre);
    let dato: InstanciaRegistrada;
    try {
      dato = JSON.parse(readFileSync(ruta, "utf8"));
    } catch {
      // Un registro ilegible es basura, no una instancia.
      if (opciones.limpiarMuertas !== false) rmSync(ruta, { force: true });
      continue;
    }
    if (procesoVivo(dato.pid)) {
      vivas.push(dato);
    } else if (opciones.limpiarMuertas !== false) {
      rmSync(ruta, { force: true });
    }
  }
  return vivas.sort((a, b) => a.arrancadaEn.localeCompare(b.arrancadaEn));
}

/**
 * Apunta este proceso y devuelve las **otras** instancias vivas del mismo
 * servicio. Deja el borrado atado a la salida del proceso.
 */
export function registrarInstancia(
  opciones: OpcionesRegistro,
): InstanciaRegistrada[] {
  const { directorioRegistro, servicio } = opciones;
  mkdirSync(directorioRegistro, { recursive: true });

  const otras = listarInstancias(directorioRegistro).filter(
    (i) => i.servicio === servicio && i.pid !== process.pid,
  );

  const propia: InstanciaRegistrada = {
    servicio,
    pid: process.pid,
    puerto: opciones.puerto ?? null,
    arrancadaEn: new Date().toISOString(),
    simulacion: opciones.simulacion ?? false,
    directorio: process.cwd(),
  };
  writeFileSync(
    rutaDe(directorioRegistro, servicio, process.pid),
    JSON.stringify(propia, null, 2),
  );

  const borrar = () => {
    try {
      rmSync(rutaDe(directorioRegistro, servicio, process.pid), {
        force: true,
      });
    } catch {
      // Salir es más importante que dejar limpio; la entrada muerta se
      // recogerá en el próximo arranque de todos modos.
    }
  };
  process.once("exit", borrar);
  for (const senal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(senal, () => {
      borrar();
      process.exit(0);
    });
  }

  return otras;
}

export class InstanciaDuplicadaError extends Error {
  constructor(
    readonly servicio: string,
    readonly otras: InstanciaRegistrada[],
  ) {
    super(
      `Ya hay ${otras.length} instancia(s) de ${servicio} en marcha ` +
        `(PID ${otras.map((o) => o.pid).join(", ")}). Dos procesos escribiendo ` +
        `la misma base y la misma cola se pisan: este no arranca.`,
    );
    this.name = "InstanciaDuplicadaError";
  }
}

/** Lanza si ya hay otra instancia viva del servicio. */
export function exigirExclusividad(
  servicio: string,
  otras: InstanciaRegistrada[],
) {
  if (otras.length > 0) throw new InstanciaDuplicadaError(servicio, otras);
}
