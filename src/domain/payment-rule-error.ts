/**
 * Regla de cobro incumplida: el operador hizo algo que el negocio no permite.
 *
 * Existe para separar «el recepcionista intentó saltarse una cuota» de «se
 * rompió el servidor». Sin esta distinción el controlador respondía 500
 * «Internal Server Error» a un cobro fuera de orden, y la web no podía explicar
 * al operador por qué su cobro no salió.
 *
 * Su mensaje SÍ se muestra al usuario: debe estar en español y ser accionable.
 */
export class PaymentRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRuleError";
  }
}
