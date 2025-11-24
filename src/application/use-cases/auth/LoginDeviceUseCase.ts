import { DeviceRepository } from "../../../domain/repositories/DeviceRepository";
import { LoginDeviceDTO } from "../../dtos/AuthDTO";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";

export class LoginDeviceUseCase {
    constructor(private deviceRepository: DeviceRepository) { }

    async execute(dto: LoginDeviceDTO): Promise<{ token: string; device_id: string; gym_id: string }> {
        const device = await this.deviceRepository.findById(dto.device_id);
        if (!device) {
            throw new Error("Invalid credentials");
        }

        if (device.secret_key !== dto.secret) {
            throw new Error("Invalid credentials");
        }

        if (!device.is_active) {
            throw new Error("Device is inactive");
        }

        await this.deviceRepository.updateLastLogin(device.device_id);

        const token = jwt.sign(
            { device_id: device.device_id, gym_id: device.gym_id, role: "device" },
            env.jwtSecret || "secret",
            { expiresIn: "24h" }
        );

        return { token, device_id: device.device_id, gym_id: device.gym_id };
    }
}
