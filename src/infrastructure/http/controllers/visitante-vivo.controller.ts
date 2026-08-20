/**
 * El estado **de ahora mismo** de un visitante, para cerrar la ventana de la
 * cancelación anticipada (docs/MULTI_SEDE.md §5.2).
 *
 * ## Qué problema resuelve
 *
 * La copia que cada sede guarda lleva la vigencia, y con eso decide bien sin
 * conexión: caducar no necesita información nueva. Lo que no puede saber una
 * sede desconectada es que en la sede del socio se **canceló la membresía antes
 * de tiempo**, porque eso solo llega por sincronización. Mientras tanto la copia
 * sigue diciendo `ACTIVA` con una fecha futura y el socio entra.
 *
 * Esta puerta la cierra **cuando hay conexión**, que es todo lo que se puede
 * cerrar: si la sede está aislada no hay forma de que sepa algo que ocurrió en
 * otro sitio. La instalación pregunta aquí justo antes de dejar entrar y decide
 * con la respuesta; si no llega a tiempo, decide con su copia y lo declara.
 *
 * ## Por qué vive en `/sync` y no en `/acceso-multisede`
 *
 * Quien pregunta es la **instalación**, no una persona: se autentica con las
 * credenciales del dispositivo, que es lo que ya tiene el escritorio. Colgarlo
 * de las rutas de usuario obligaría a que el mostrador guardase una sesión
 * contra el concentrador, que es justo lo que no puede asumirse en una sede que
 * a veces está sin conexión.
 */
import type { Context } from "hono";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../db/prismaClient";

export async function getVisitanteEnVivo(c: Context) {
  const sesion = c.get("auth") as { gymId?: string } | undefined;
  const gymId = String(sesion?.gymId ?? "").trim();
  if (!gymId) {
    return c.json({ error: "El dispositivo no identifica su sede." }, 403);
  }
  const ci = String(c.req.param("ci") ?? "").trim();
  if (!ci) return c.json({ error: "Falta la cédula." }, 400);

  const [copia, acceso] = await Promise.all([
    prisma.clienteVisitante.findFirst({ where: { ci, is_deleted: false } }),
    prisma.clienteAccesoMultisede.findFirst({ where: { ci, is_deleted: false } }),
  ]);

  // Que no exista es una respuesta, no un error: la copia pudo retirarse porque
  // el plus caducó, y la instalación tiene que poder distinguir «ya no procede»
  // de «no me contestaron». Por eso va con 200 y `existe: false`.
  if (!copia) {
    return c.json({
      ci,
      existe: false,
      consultado_at: trustedClock.nowUtc().toISOString(),
    });
  }

  // Una sede no pregunta por sus propios socios: para esos tiene la ficha.
  if (String(copia.gym_id_origen) === gymId) {
    return c.json({ error: "Ese socio es de esta sede." }, 409);
  }

  return c.json({
    ci,
    existe: true,
    gym_id_origen: copia.gym_id_origen,
    membresia_estado: copia.membresia_estado,
    membresia_fecha_fin: copia.membresia_fecha_fin,
    // El plus se responde con su fecha, no con un «vigente»: quien decide es la
    // instalación, contra SU día de negocio, que puede no ser el de aquí.
    acceso_vigente_hasta: acceso?.vigente_hasta ?? null,
    consultado_at: trustedClock.nowUtc().toISOString(),
  });
}
