import { Hono } from "hono";
import * as clients from "../controllers/clients.controller";
import { requireAdmin } from "../middleware/auth.middleware";

export function clientsRoutes() {
    const app = new Hono();

    // Mismo reparto que en `/clientes` y `/asistencias`: el mostrador registra
    // y consulta; borrar del historial es de administración.
    // Rutas específicas antes del parámetro genérico de cliente.
    app.get("/clientes/:ci/pesos", clients.getPesosByCliente);
    app.get("/clientes/:ci/asistencias", clients.getAsistenciasByCliente);
    app.get("/pesos/:id", clients.getPesoById);
    app.post("/clientes/pesos", clients.createClientePeso);
    app.put("/pesos/:id", clients.updateClientePeso);
    app.delete("/pesos/:id", requireAdmin(), clients.deleteClientePeso);

    app.get("/asistencias/:id", clients.getAsistenciaById);
    app.post("/asistencias", clients.createAsistencia);
    app.delete("/asistencias/:id", requireAdmin(), clients.deleteAsistencia);

    // Cliente
    app.get("/clientes", clients.getClientes);
    app.get("/clientes/:id", clients.getClienteByCi);
    app.post("/clientes", clients.createCliente);
    app.put("/clientes/:id", clients.updateCliente);
    app.delete("/clientes/:id", requireAdmin(), clients.deleteCliente);

    return app;
}
