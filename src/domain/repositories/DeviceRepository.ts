import { Device } from "@prisma/client";

export interface DeviceRepository {
    findById(id: string): Promise<Device | null>;
    updateLastLogin(id: string): Promise<void>;
}
