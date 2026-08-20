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
import { certificadoIntacto } from "../src/domain/certificado-cadena-policy";

const dia = (fecha: Date) => fecha.toISOString().slice(0, 10);

try {
  const certificados = await prisma.cierreCadenaCertificado.findMany({
    orderBy: [{ fecha_inicio: "asc" }, { ciclo_numero: "asc" }],
  });

  if (certificados.length === 0) {
    console.log("No hay certificados guardados: nada que comprobar.");
    process.exit(0);
  }

  const rotos: string[] = [];
  for (const fila of certificados) {
    const intacto = certificadoIntacto({
      textoFirmado: fila.foto_json,
      sha256: fila.foto_sha256,
    });
    // Se listan **todos**, también los que están bien: un informe que solo
    // habla cuando hay problema no distingue «todo correcto» de «no se ejecutó».
    console.log(
      [
        intacto ? "OK  " : "ROTO",
        fila.certificado_id.slice(0, 8),
        `${dia(fila.fecha_inicio)}→${dia(fila.fecha_fin_exclusiva)}`,
        `ciclo ${fila.ciclo_numero}`,
        fila.estado.padEnd(8),
        fila.is_deleted ? "retirado" : "",
      ].join("  "),
    );
    if (!intacto) rotos.push(fila.certificado_id);
  }

  console.log(
    `\n${certificados.length} certificado(s) · ${
      certificados.length - rotos.length
    } con el sello intacto · ${rotos.length} roto(s).`,
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
