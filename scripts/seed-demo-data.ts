import { prisma } from "../src/infrastructure/db/prismaClient";

async function seedGymsAndDevices() {
    await prisma.gym.update({
        where: { gym_id: "local-gym-001" },
        data: { nombre: "Gym Test (updated)" },
    });

    await prisma.gym.upsert({
        where: { gym_id: "demo-gym-002" },
        update: { deleted_at: new Date(), activo: false },
        create: {
            gym_id: "demo-gym-002",
            codigo: "GYM002",
            nombre: "Gym Demo 2",
            direccion: "Demo Street 123",
            ciudad: "Demo City",
            pais: "Nowhere",
            timezone: "America/New_York",
            activo: true,
        },
    });

    await prisma.device.upsert({
        where: { device_id: "demo-device-1" },
        update: { nombre: "Device Demo 1 (updated)" },
        create: {
            device_id: "demo-device-1",
            gym_id: "local-gym-001",
            nombre: "Device Demo 1",
            tipo: "BACKEND_OFFLINE",
            is_active: true,
        },
    });

    await prisma.device.upsert({
        where: { device_id: "demo-device-2" },
        update: { is_active: false, deleted_at: new Date() },
        create: {
            device_id: "demo-device-2",
            gym_id: "local-gym-001",
            nombre: "Device Demo 2",
            tipo: "BACKEND_OFFLINE",
            is_active: false,
            deleted_at: new Date(),
        },
    });
}

async function seedCatalogs() {
    // Parity catalogs so remote matches local seed IDs
    await prisma.moneda.upsert({
        where: { moneda_id: "seed-moneda-1" },
        update: { moneda_nombre: "Seed Dollar (remote)" },
        create: {
            moneda_id: "seed-moneda-1",
            moneda_nombre: "Seed Dollar",
            codigo: "SD1",
            simbolo: "$",
        },
    });

    await prisma.nacionalidad.upsert({
        where: { nacionalidad_id: "seed-nac-1" },
        update: { nacionalidad_nombre: "Seedlandia Remote" },
        create: {
            nacionalidad_id: "seed-nac-1",
            nacionalidad_nombre: "Seedlandia",
            codigo_iso: "SD",
        },
    });

    await prisma.tipoPago.upsert({
        where: { tipo_pago_id: "seed-tp-1" },
        update: { nombre_tipo_pago: "Seed Cash (remote)" },
        create: {
            tipo_pago_id: "seed-tp-1",
            nombre_tipo_pago: "Seed Cash",
        },
    });

    await prisma.tipoCambio.upsert({
        where: { tipo_cambio_id: "seed-tc-1" },
        update: { exchange_rate: 1 },
        create: {
            tipo_cambio_id: "seed-tc-1",
            moneda_id_base: "seed-moneda-1",
            moneda_id_target: "seed-moneda-1",
            exchange_rate: 1,
            fecha_inicio: new Date(),
        },
    });

    await prisma.referencia.upsert({
        where: { referencia_id: "seed-ref-1" },
        update: { nombre_referencia: "Seed Friend (remote)" },
        create: {
            referencia_id: "seed-ref-1",
            nombre_referencia: "Seed Friend",
        },
    });

    await prisma.horario.upsert({
        where: { horario_id: "seed-horario-1" },
        update: { nombre_horario: "Seed Morning (remote)" },
        create: {
            horario_id: "seed-horario-1",
            nombre_horario: "Seed Morning",
            hora_inicio: 6,
            hora_fin: 12,
            gym_id: "local-gym-001",
        },
    });

    await prisma.planesPago.upsert({
        where: { id_planes_pago: "seed-plan-1" },
        update: { nombre_plan_pago: "Plan Seed Remote" },
        create: {
            id_planes_pago: "seed-plan-1",
            nombre_plan_pago: "Plan Seed",
            importe_plan_pago: 75,
            duracion_plan_pago: 30,
            moneda_id: "seed-moneda-1",
            gym_id: "local-gym-001",
        },
    });

    await prisma.cuenta.upsert({
        where: { cuenta_id: "seed-cuenta-1" },
        update: { nombre_cuenta: "Cuenta Seed Remote" },
        create: {
            cuenta_id: "seed-cuenta-1",
            nombre_cuenta: "Cuenta Seed",
            moneda_id: "seed-moneda-1",
            gym_id: "local-gym-001",
        },
    });

    await prisma.moneda.upsert({
        where: { moneda_id: "demo-moneda-1" },
        update: { moneda_nombre: "Demo Dollar (updated)" },
        create: {
            moneda_id: "demo-moneda-1",
            moneda_nombre: "Demo Dollar",
            codigo: "DMD",
            simbolo: "$",
        },
    });

    await prisma.moneda.upsert({
        where: { moneda_id: "demo-moneda-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            moneda_id: "demo-moneda-2",
            moneda_nombre: "Demo Peso",
            codigo: "DMP",
            simbolo: "P",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.nacionalidad.upsert({
        where: { nacionalidad_id: "demo-nac-1" },
        update: { nacionalidad_nombre: "Nac Demo 1 (updated)" },
        create: {
            nacionalidad_id: "demo-nac-1",
            nacionalidad_nombre: "Nac Demo 1",
            codigo_iso: "ND1",
        },
    });

    await prisma.nacionalidad.upsert({
        where: { nacionalidad_id: "demo-nac-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            nacionalidad_id: "demo-nac-2",
            nacionalidad_nombre: "Nac Demo 2",
            codigo_iso: "ND2",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.tipoPago.upsert({
        where: { tipo_pago_id: "demo-tp-1" },
        update: { nombre_tipo_pago: "Pago Demo (updated)" },
        create: {
            tipo_pago_id: "demo-tp-1",
            nombre_tipo_pago: "Pago Demo",
        },
    });

    await prisma.tipoPago.upsert({
        where: { tipo_pago_id: "demo-tp-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            tipo_pago_id: "demo-tp-2",
            nombre_tipo_pago: "Pago Demo B",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.tipoCambio.upsert({
        where: { tipo_cambio_id: "demo-tc-1" },
        update: { exchange_rate: 1.05 },
        create: {
            tipo_cambio_id: "demo-tc-1",
            moneda_id_base: "demo-moneda-1",
            moneda_id_target: "demo-moneda-1",
            exchange_rate: 1,
            fecha_inicio: new Date(),
        },
    });

    await prisma.tipoCambio.upsert({
        where: { tipo_cambio_id: "demo-tc-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            tipo_cambio_id: "demo-tc-2",
            moneda_id_base: "demo-moneda-1",
            moneda_id_target: "demo-moneda-1",
            exchange_rate: 0.95,
            fecha_inicio: new Date(),
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.referencia.upsert({
        where: { referencia_id: "demo-ref-1" },
        update: { nombre_referencia: "Referencia Demo (updated)" },
        create: {
            referencia_id: "demo-ref-1",
            nombre_referencia: "Referencia Demo 1",
        },
    });

    await prisma.referencia.upsert({
        where: { referencia_id: "demo-ref-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            referencia_id: "demo-ref-2",
            nombre_referencia: "Referencia Demo 2",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.horario.upsert({
        where: { horario_id: "demo-horario-1" },
        update: { nombre_horario: "Horario Demo (updated)" },
        create: {
            horario_id: "demo-horario-1",
            nombre_horario: "Horario Demo 1",
            hora_inicio: 8,
            hora_fin: 12,
            gym_id: "local-gym-001",
        },
    });

    await prisma.horario.upsert({
        where: { horario_id: "demo-horario-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            horario_id: "demo-horario-2",
            nombre_horario: "Horario Demo 2",
            hora_inicio: 14,
            hora_fin: 18,
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.planesPago.upsert({
        where: { id_planes_pago: "demo-plan-1" },
        update: { nombre_plan_pago: "Plan Demo (updated)" },
        create: {
            id_planes_pago: "demo-plan-1",
            nombre_plan_pago: "Plan Demo 1",
            importe_plan_pago: 40,
            duracion_plan_pago: 30,
            moneda_id: "demo-moneda-1",
            gym_id: "local-gym-001",
        },
    });

    await prisma.planesPago.upsert({
        where: { id_planes_pago: "demo-plan-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            id_planes_pago: "demo-plan-2",
            nombre_plan_pago: "Plan Demo 2",
            importe_plan_pago: 25,
            duracion_plan_pago: 15,
            moneda_id: "demo-moneda-1",
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.cuenta.upsert({
        where: { cuenta_id: "demo-cuenta-1" },
        update: { nombre_cuenta: "Cuenta Demo (updated)" },
        create: {
            cuenta_id: "demo-cuenta-1",
            nombre_cuenta: "Cuenta Demo 1",
            moneda_id: "demo-moneda-1",
            gym_id: "local-gym-001",
        },
    });

    await prisma.cuenta.upsert({
        where: { cuenta_id: "demo-cuenta-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            cuenta_id: "demo-cuenta-2",
            nombre_cuenta: "Cuenta Demo 2",
            moneda_id: "demo-moneda-1",
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.entrenador.upsert({
        where: { id_entrenador: "demo-trainer-1" },
        update: { nombres_entrenador: "Trainer Demo (updated)" },
        create: {
            id_entrenador: "demo-trainer-1",
            ci_entrenador: "TRAINER-DEM1",
            nombres_entrenador: "Trainer Demo 1",
            apellidos_entrenador: "Remote",
            sexo_entrenador: "M",
            activo_entrenador: true,
            fecha_incio_entrenador: new Date(),
            gym_id: "local-gym-001",
        },
    });

    await prisma.entrenador.upsert({
        where: { id_entrenador: "demo-trainer-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            id_entrenador: "demo-trainer-2",
            ci_entrenador: "TRAINER-DEM2",
            nombres_entrenador: "Trainer Demo 2",
            apellidos_entrenador: "Remote",
            sexo_entrenador: "F",
            activo_entrenador: false,
            fecha_incio_entrenador: new Date(),
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });
}

async function seedClientsAndPayments() {
    const clientAId = `REM-${Date.now()}-A`;
    const clientBId = `REM-${Date.now()}-B`;

    await prisma.cliente.upsert({
        where: { ci: clientAId },
        update: { nombres: "Cliente Remote (updated)" },
        create: {
            ci: clientAId,
            nombres: "Cliente Remote A",
            apellidos: "Demo",
            sexo: "M",
            cliente_peso_id: `peso-${crypto.randomUUID()}`,
            estatura_cliente: 170,
            nacionalidad_id: "demo-nac-1",
            id_planes_pago: "demo-plan-1",
            fecha_inicio: new Date(),
            fecha_fin: new Date(Date.now() + 30 * 86400000),
            activo: true,
            id_horarios: "demo-horario-1",
            referencia_id: "demo-ref-1",
            gym_id: "local-gym-001",
            id_entrenador: "demo-trainer-1",
        },
    });

    await prisma.cliente.upsert({
        where: { ci: clientBId },
        update: { is_deleted: true, deleted_at: new Date(), activo: false },
        create: {
            ci: clientBId,
            nombres: "Cliente Remote B",
            apellidos: "Demo",
            sexo: "F",
            cliente_peso_id: `peso-${crypto.randomUUID()}`,
            estatura_cliente: 165,
            nacionalidad_id: "demo-nac-1",
            id_planes_pago: "demo-plan-1",
            fecha_inicio: new Date(),
            fecha_fin: new Date(Date.now() + 30 * 86400000),
            activo: false,
            id_horarios: "demo-horario-1",
            referencia_id: "demo-ref-1",
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.clientePeso.upsert({
        where: { cliente_peso_id: "demo-peso-1" },
        update: { peso: 81 },
        create: {
            cliente_peso_id: "demo-peso-1",
            ci: clientAId,
            fecha: new Date(),
            peso: 80,
            gym_id: "local-gym-001",
        },
    });

    await prisma.clientePeso.upsert({
        where: { cliente_peso_id: "demo-peso-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            cliente_peso_id: "demo-peso-2",
            ci: clientAId,
            fecha: new Date(),
            peso: 82,
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.asistencia.upsert({
        where: { asistencia_id: "demo-asistencia-1" },
        update: { updated_at: new Date(), version: 2 },
        create: {
            asistencia_id: "demo-asistencia-1",
            ci: clientAId,
            gym_id: "local-gym-001",
        },
    });

    await prisma.asistencia.upsert({
        where: { asistencia_id: "demo-asistencia-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            asistencia_id: "demo-asistencia-2",
            ci: clientAId,
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.pagoCliente.upsert({
        where: { pago_cliente_id: "demo-pay-1" },
        update: { monto_total: 60 },
        create: {
            pago_cliente_id: "demo-pay-1",
            ci: clientAId,
            fecha: new Date(),
            monto_total: 55,
            id_planes_pago: "demo-plan-1",
            moneda_id: "demo-moneda-1",
            gym_id: "local-gym-001",
        },
    });

    await prisma.pagoCliente.upsert({
        where: { pago_cliente_id: "demo-pay-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            pago_cliente_id: "demo-pay-2",
            ci: clientAId,
            fecha: new Date(),
            monto_total: 35,
            id_planes_pago: "demo-plan-1",
            moneda_id: "demo-moneda-1",
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });

    await prisma.detallePago.upsert({
        where: { detalle_pago_id: "demo-detalle-1" },
        update: { cantidad: 60 },
        create: {
            detalle_pago_id: "demo-detalle-1",
            pago_cliente_id: "demo-pay-1",
            tipo_pago_id: "demo-tp-1",
            moneda_id: "demo-moneda-1",
            cuenta_id: "demo-cuenta-1",
            cantidad: 55,
            tipo_cambio_id: "demo-tc-1",
            gym_id: "local-gym-001",
        },
    });

    await prisma.detallePago.upsert({
        where: { detalle_pago_id: "demo-detalle-2" },
        update: { is_deleted: true, deleted_at: new Date() },
        create: {
            detalle_pago_id: "demo-detalle-2",
            pago_cliente_id: "demo-pay-2",
            tipo_pago_id: "demo-tp-1",
            moneda_id: "demo-moneda-1",
            cuenta_id: "demo-cuenta-1",
            cantidad: 35,
            tipo_cambio_id: "demo-tc-1",
            gym_id: "local-gym-001",
            is_deleted: true,
            deleted_at: new Date(),
        },
    });
}

async function main() {
    await seedGymsAndDevices();
    await seedCatalogs();
    await seedClientsAndPayments();
    console.log("[seed-remote] Demo data inserted/updated/deleted");
}

main()
    .catch((err) => {
        console.error("[seed-remote] Failed:", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
