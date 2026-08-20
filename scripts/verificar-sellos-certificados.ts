/**
 * Comprueba el sello de **todos** los certificados guardados (§6.4).
 *
 * ## Por qué existe
 *
 * La verificación se hacía solo **al leer**, y quien la miraba era quien pedía
 * la lista. Una comprobación que únicamente ocurre si alguien mira no ocurre: un
 * certificado roto podía quedarse meses en la base y el día que alguien lo
 * abriera diría «manipulado» sin que nadie pudiera saber desde cuándo.
 *
 * Aquí, en el concentrador, es donde se **firman**, así que un sello que no
 * cuadre no viene de un viaje: viene de que alguien tocó la fila. La instalación
 * tiene además la comprobación de la bajada; este es el original.
 *
 * ## Qué comprueba, y qué no
 *
 * Recalcula el `sha256` del **texto que se firmó** y lo compara con el sello
 * guardado. No reconstruye la foto desde las columnas: eso mediría la
 * serialización de hoy y no la firma de entonces, y un cambio inocente de
 * formato daría por manipulados certificados que nadie tocó.
 *
 * No dice si el contenido es *correcto* —eso lo decidió quien firmó—, solo si
 * **es el mismo** que se selló.
 *
 * Uso:
 *   bun run verificar:sellos
 *
 * Devuelve 1 si algún sello no cuadra, para que pueda encadenarse.
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { auditarSellosDeCertificados } from "../src/application/accounting/auditoria-de-sellos";

const dia = (fecha: Date) => fecha.toISOString().slice(0, 10);

try {
  // El repaso lo hace la misma función que usa la pasada programada: escribir
  // aquí una comprobación parecida acabaría con dos que se parecen, y el día que
  // importe dirían cosas distintas.
  const r = await auditarSellosDeCertificados(prisma as never);

  if (r.revisados === 0) {
    console.log("No hay certificados guardados: nada que comprobar.");
    process.exit(0);
  }

  for (const sello of r.detalle) {
    // Se listan **todos**, también los que están bien: un informe que solo
    // habla cuando hay problema no distingue «todo correcto» de «no se ejecutó».
    console.log(
      [
        sello.intacto ? "OK  " : "ROTO",
        sello.certificadoId.slice(0, 8),
        `${dia(sello.desde)}→${dia(sello.hastaExclusivo)}`,
        `ciclo ${sello.cicloNumero}`,
        sello.estado.padEnd(8),
        sello.retirado ? "retirado" : "",
      ].join("  "),
    );
  }

  const rotos = r.rotos;
  console.log(
    `\n${r.revisados} certificado(s) · ${r.intactos} con el sello intacto ` +
      `· ${rotos.length} roto(s).`,
  );
  if (rotos.length > 0) {
    // Un certificado roto no se borra ni se repara aquí: es una foto sellada, y
    // arreglarla sería falsificarla. Lo que procede es traerla otra vez del
    // concentrador, que es quien la firmó.
    console.log(
      "Rotos: " +
        rotos.join(", ") +
        "\nNo se reparan desde aquí: se vuelven a pedir al concentrador, que es " +
        "quien los firmó.",
    );
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}
