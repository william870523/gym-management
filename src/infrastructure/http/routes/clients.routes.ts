import { Hono } from "hono";
import * as clients from "../controllers/clients.controller";

export function clientsRoutes() {
    const app = new Hono();

    // Cliente
    app.get("/clientes", clients.getClientes);
    app.get("/clientes/:ci", clients.getClienteByCi);
    app.post("/clientes", clients.createCliente);
    app.put("/clientes/:ci", clients.updateCliente);
    app.delete("/clientes/:ci", clients.deleteCliente);

    // ClientePeso
    app.get("/clientes/:ci/pesos", clients.getPesosByCliente);
    app.get("/pesos/:id", clients.getPesoById);
    app.post("/clientes/pesos", clients.createClientePeso);
    app.put("/pesos/:id", clients.updateClientePeso);
    app.delete("/pesos/:id", clients.deleteClientePeso);

    // Asistencia
    app.get("/clientes/:ci/asistencias", clients.getAsistenciasByCliente);
    app.get("/asistencias/:id", clients.getAsistenciaById);
    app.post("/asistencias", clients.createAsistencia);
    app.delete("/asistencias/:id", clients.deleteAsistencia);

    return app;
}
