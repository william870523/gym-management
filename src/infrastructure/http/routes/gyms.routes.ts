import { Hono } from "hono";
import * as gyms from "../controllers/gyms.controller";

export const gymsRoutes = () => {
    const r = new Hono();

    // Gym CRUD (mounted under /gyms)
    r.get("/", gyms.getGyms);
    r.post("/", gyms.createGym);

    // Device CRUD (mounted under /gyms/devices) - MUST BE BEFORE /:id
    r.get("/devices", gyms.getDevices);
    r.get("/devices/:id", gyms.getDeviceById);
    r.post("/devices", gyms.createDevice);
    r.put("/devices/:id", gyms.updateDevice);
    r.delete("/devices/:id", gyms.deleteDevice);

    // Gym ID routes (generic)
    r.get("/:id", gyms.getGymById);
    r.put("/:id", gyms.updateGym);
    r.delete("/:id", gyms.deleteGym);

    return r;
};
