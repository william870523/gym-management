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
 * ## De dónde sale la respuesta
 *
 * La identidad y la sede dueña salen de `cliente_visitante`; **el estado de la
 * membresía, no**. Esa copia es una proyección para que las sedes decidan sin
 * conexión, y se escribe solo al marcar el plus y al cobrarlo. Contestar desde
 * ella dejaba esta consulta sin sentido: preguntaba «¿cómo está ahora?» y
 * respondía con la foto de cuando alguien pagó. Aquí se lee la membresía de
 * verdad, que el concentrador tiene porque todas las sedes suben la suya.
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

  // **La copia dice quién es; la membresía dice cómo está.** Responder el
  // estado desde `cliente_visitante` era responder con la misma proyección cuya
  // vejez esta consulta viene a corregir: se escribe al marcar el plus y al
  // cobrarlo, y **nada la vuelve a tocar** cuando en la sede del socio se
  // cancela o se renueva. Medido el 20-08-2026: la copia daba la cobertura por
  // terminada el 23/09/2026 y el socio había renovado hasta el 20/06/2027.
  //
  // El concentrador sí tiene la membresía de verdad —todas las sedes suben la
  // suya—, así que la lee. Se acota a la sede de origen: la ficha del socio vive
  // allí y una fila con su CI en otra sede sería un error que no conviene
  // heredar aquí.
  const membresia = await prisma.membresiaCliente.findFirst({
    where: { ci, gym_id: copia.gym_id_origen, is_deleted: false },
    orderBy: { fecha_fin: "desc" },
    select: { estado: true, fecha_fin: true },
  });

  return c.json({
    ci,
    existe: true,
    gym_id_origen: copia.gym_id_origen,
    membresia_estado: membresia?.estado ?? null,
    membresia_fecha_fin: membresia?.fecha_fin ?? null,
    // El plus se responde con su fecha, no con un «vigente»: quien decide es la
    // instalación, contra SU día de negocio, que puede no ser el de aquí.
    acceso_vigente_hasta: acceso?.vigente_hasta ?? null,
    consultado_at: trustedClock.nowUtc().toISOString(),
  });
}
