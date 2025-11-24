import { PrismaClient, Device } from "@prisma/client";
import { DeviceRepository } from "../../domain/repositories/DeviceRepository";

const prisma = new PrismaClient();

export class PrismaDeviceRepository implements DeviceRepository {
    async findById(id: string): Promise<Device | null> {
        return prisma.device.findUnique({
            where: { device_id: id }
        });
    }

    async updateLastLogin(id: string): Promise<void> {
        await prisma.device.update({
            where: { device_id: id },
            data: { last_login_at: new Date() }
        });
    }
}
