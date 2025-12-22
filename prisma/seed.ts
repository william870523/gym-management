// Seed script for REMOTE database (MariaDB)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedRemote() {
    console.log("🌱 Seeding REMOTE database...");

    // 1. Gym
    await prisma.gym.upsert({
        where: { gym_id: "local-gym-001" },
        update: {},
        create: {
            gym_id: "local-gym-001",
            codigo: "GYM_LOCAL_001",
            nombre: "Gym Test",
            direccion: "Calle Principal 123",
            ciudad: "Santo Domingo",
            provincia: "Distrito Nacional",
            pais: "República Dominicana",
            timezone: "America/Santo_Domingo",
            activo: true,
        },
    });
    console.log("✅ Gym created");

    // 2. Moneda
    await prisma.moneda.upsert({
        where: { moneda_id: "test-moneda-usd" },
        update: {},
        create: {
            moneda_id: "test-moneda-usd",
            moneda_nombre: "Dólar Estadounidense",
            codigo: "USD",
            simbolo: "$",
        },
    });
    console.log("✅ Moneda created");

    // 3. Nacionalidad
    await prisma.nacionalidad.upsert({
        where: { nacionalidad_id: "test-nacionalidad-do" },
        update: {},
        create: {
            nacionalidad_id: "test-nacionalidad-do",
            nacionalidad_nombre: "Dominicana",
            codigo_iso: "DO",
        },
    });
    console.log("✅ Nacionalidad created");

    // 4. TipoPago
    await prisma.tipoPago.upsert({
        where: { tipo_pago_id: "test-tipo-efectivo" },
        update: {},
        create: {
            tipo_pago_id: "test-tipo-efectivo",
            nombre_tipo_pago: "Efectivo",
        },
    });
    console.log("✅ TipoPago created");

    // 5. Horario
    await prisma.horario.upsert({
        where: { horario_id: "test-horario-manana" },
        update: {},
        create: {
            horario_id: "test-horario-manana",
            nombre_horario: "Mañana",
            hora_inicio: 6,
            hora_fin: 12,
            gym_id: "local-gym-001",
        },
    });
    console.log("✅ Horario created");

    // 6. PlanesPago
    await prisma.planesPago.upsert({
        where: { id_planes_pago: "test-plan-mensual" },
        update: {},
        create: {
            id_planes_pago: "test-plan-mensual",
            nombre_plan_pago: "Plan Mensual",
            importe_plan_pago: 50.0,
            duracion_plan_pago: 30,
            activo: true,
            moneda_id: "test-moneda-usd",
            gym_id: "local-gym-001",
        },
    });
    console.log("✅ PlanesPago created");

    // 7. Referencia
    await prisma.referencia.upsert({
        where: { referencia_id: "test-ref-amigo" },
        update: {},
        create: {
            referencia_id: "test-ref-amigo",
            nombre_referencia: "Recomendación de amigo",
        },
    });
    console.log("✅ Referencia created");

    // 8. Cuenta
    await prisma.cuenta.upsert({
        where: { cuenta_id: "test-cuenta-caja" },
        update: {},
        create: {
            cuenta_id: "test-cuenta-caja",
            nombre_cuenta: "Caja Principal",
            moneda_id: "test-moneda-usd",
            gym_id: "local-gym-001",
        },
    });
    console.log("✅ Cuenta created");

    // 9. TipoCambio
    await prisma.tipoCambio.upsert({
        where: { tipo_cambio_id: "test-tc-usd-usd" },
        update: {},
        create: {
            tipo_cambio_id: "test-tc-usd-usd",
            moneda_id_base: "test-moneda-usd",
            moneda_id_target: "test-moneda-usd",
            exchange_rate: 1.0,
            fecha_inicio: new Date(),
            activo: true,
        },
    });
    console.log("✅ TipoCambio created");

    // 10. Entrenador
    await prisma.entrenador.upsert({
        where: { id_entrenador: "test-entrenador-001" },
        update: {},
        create: {
            id_entrenador: "test-entrenador-001",
            ci_entrenador: "TRAINER-001",
            nombres_entrenador: "Juan",
            apellidos_entrenador: "Pérez",
            sexo_entrenador: "M",
            activo_entrenador: true,
            fecha_incio_entrenador: new Date(),
            gym_id: "local-gym-001",
        },
    });
    console.log("✅ Entrenador created");

    // 11. Device (for local gym sync)
    await prisma.device.upsert({
        where: { device_id: "device-001" },
        update: {
            is_active: true,
            deleted_at: null,
            secret_key: "mock-device-token",
        },
        create: {
            device_id: "device-001",
            gym_id: "local-gym-001",
            nombre: "Local Primary Device",
            tipo: "BACKEND_OFFLINE",
            secret_key: "mock-device-token",
            is_active: true,
        },
    });
    console.log("✅ Device created/updated");

    const count = await prisma.device.count();
    const all = await prisma.device.findMany();
    console.log(`📊 Total Devices in DB (${process.env.DATABASE_URL?.substring(0, 15)}...): ${count}`);
    console.log("Devices:", all.map(d => `${d.device_id} (${d.is_active})`));

    console.log("✅ REMOTE database seeded successfully!");
    await prisma.$disconnect();
}

seedRemote().catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
});
