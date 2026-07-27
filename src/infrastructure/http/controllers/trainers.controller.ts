import type { Context } from "hono";
import { EntrenadorController } from "./EntrenadorController";

// Alias compatible: toda la superficie /trainers reutiliza el mismo
// controlador, casos de uso, scope tenant y sync que /entrenadores.
const controller = new EntrenadorController();

export const getEntrenadores = (c: Context) => controller.list(c);
export const getEntrenadorById = (c: Context) => controller.getById(c);
export const createEntrenador = (c: Context) => controller.create(c);
export const updateEntrenador = (c: Context) => controller.update(c);
export const deleteEntrenador = (c: Context) => controller.delete(c);
