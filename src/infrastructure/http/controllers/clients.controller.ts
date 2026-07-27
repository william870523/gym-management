import type { Context } from "hono";
import { AsistenciaController } from "./AsistenciaController";
import { ClienteController } from "./ClienteController";
import { ClientePesoController } from "./ClientePesoController";

// Aliases compatibles: /clients no mantiene un segundo CRUD Prisma. Toda
// operación reutiliza los casos de uso tenant y el sync de las rutas canónicas.
const clienteController = new ClienteController();
const pesoController = new ClientePesoController();
const asistenciaController = new AsistenciaController();

export const getClientes = (c: Context) => clienteController.list(c);
export const getClienteByCi = (c: Context) => clienteController.getById(c);
export const createCliente = (c: Context) => clienteController.create(c);
export const updateCliente = (c: Context) => clienteController.update(c);
export const deleteCliente = (c: Context) => clienteController.delete(c);

export const getPesosByCliente = (c: Context) => pesoController.list(c);
export const getPesoById = (c: Context) => pesoController.getById(c);
export const createClientePeso = (c: Context) => pesoController.create(c);
export const updateClientePeso = (c: Context) => pesoController.update(c);
export const deleteClientePeso = (c: Context) => pesoController.delete(c);

export const getAsistenciasByCliente = (c: Context) => asistenciaController.list(c);
export const getAsistenciaById = (c: Context) => asistenciaController.getById(c);
export const createAsistencia = (c: Context) => asistenciaController.create(c);
export const deleteAsistencia = (c: Context) => asistenciaController.delete(c);
