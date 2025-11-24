import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

const BASE_URL = "http://localhost:3001";
let ADMIN_TOKEN = "";

// Colores para consola
const C = {
    RESET: "\x1b[0m",
    RED: "\x1b[31m",
    GREEN: "\x1b[32m",
    YELLOW: "\x1b[33m",
    BLUE: "\x1b[34m",
    CYAN: "\x1b[36m",
    BOLD: "\x1b[1m"
};

async function logStep(step: string) {
    console.log(`\n${C.BOLD}${C.CYAN}=== ${step} ===${C.RESET}`);
}

async function logResult(name: string, success: boolean, data?: any) {
    if (success) {
        console.log(`${C.GREEN}✅ ${name}${C.RESET}`);
        if (data) console.log(C.BLUE + JSON.stringify(data, null, 2) + C.RESET);
    } else {
        console.log(`${C.RED}❌ ${name}${C.RESET}`);
        if (data) console.log(C.RED + JSON.stringify(data, null, 2) + C.RESET);
    }
}

async function request(method: string, path: string, body?: any, token?: string) {
    const headers: any = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        const text = await res.text();
        try {
            return { status: res.status, data: JSON.parse(text) };
        } catch {
            return { status: res.status, data: text };
        }
    } catch (error) {
        return { status: 0, data: error.message };
    }
}

async function verifyEntity(name: string, endpoint: string, createPayload: any) {
    await logStep(`Verificando ${name} (${endpoint})`);

    // 1. LISTAR
    let listRes = await request("GET", endpoint, null, ADMIN_TOKEN);
    await logResult(`GET ${endpoint}`, listRes.status === 200, listRes.data);

    if (listRes.status !== 200) {
        console.log(`${C.RED}⚠️ Error listando ${name}. Saltando creación.${C.RESET}`);
        return;
    }

    // Si está vacío o queremos probar creación igual
    // 2. CREAR
    console.log(`Intentando crear nuevo ${name}...`);
    const createRes = await request("POST", endpoint, createPayload, ADMIN_TOKEN);
    await logResult(`POST ${endpoint}`, createRes.status === 201 || createRes.status === 200, createRes.data);

    // 3. LISTAR DE NUEVO
    if (createRes.status === 201 || createRes.status === 200) {
        console.log(`Verificando que aparece en la lista...`);
        listRes = await request("GET", endpoint, null, ADMIN_TOKEN);
        const createdId = createRes.data.id || createRes.data.gym_id || createRes.data.device_id || createRes.data.moneda_id || createRes.data.nacionalidad_id; // Ajustar según entidad

        // Buscar en la lista (asumiendo que devuelve array)
        if (Array.isArray(listRes.data)) {
            const found = listRes.data.find((item: any) =>
                item.id === createdId ||
                item.gym_id === createdId ||
                item.device_id === createdId ||
                item.moneda_id === createdId ||
                item.nacionalidad_id === createdId
            );
            await logResult(`Item encontrado en lista`, !!found, found);
        } else {
            console.log(`${C.YELLOW}⚠️ La lista no es un array: ${JSON.stringify(listRes.data)}${C.RESET}`);
        }
    }
}

async function main() {
    console.log(`${C.BOLD}🚀 INICIANDO VERIFICACIÓN EXHAUSTIVA DE API${C.RESET}`);

    // 1. LOGIN
    await logStep("Autenticación Admin");
    const loginRes = await request("POST", "/auth/login", {
        email: "admin@test.com",
        password: "admin123"
    });

    if (loginRes.status === 200 && loginRes.data.token) {
        ADMIN_TOKEN = loginRes.data.token;
        await logResult("Login Admin", true, { token: "Token obtenido correctamente (oculto)", role: loginRes.data.role });
    } else {
        await logResult("Login Admin", false, loginRes.data);
        console.log(`${C.RED}❌ No se puede continuar sin token de admin.${C.RESET}`);
        process.exit(1);
    }

    // 2. GYMS
    await verifyEntity("Gimnasios", "/gyms", {
        gym_id: `gym-${Date.now()}`,
        codigo: `GYM-${Date.now()}`,
        nombre: "Gimnasio de Prueba Script",
        activo: true
    });

    // 3. DEVICES (El que daba error)
    // Necesitamos un gym_id válido. Usaremos gym-1 si existe, o el que acabamos de crear.
    const gymId = "gym-1";

    await verifyEntity("Dispositivos", "/gyms/devices", {
        device_id: `dev-${Date.now()}`,
        gym_id: gymId,
        nombre: "Dispositivo Script",
        secret_key: "secretScript",
        is_active: true
    });

    // 4. MONEDAS
    await verifyEntity("Monedas", "/monedas", {
        moneda_id: `mon-${Date.now()}`,
        moneda_nombre: "Moneda Test",
        codigo: `MT${Date.now() % 1000}`,
        simbolo: "$"
    });

    // 5. NACIONALIDADES
    await verifyEntity("Nacionalidades", "/nacionalidades", {
        nacionalidad_id: `nac-${Date.now()}`,
        nacionalidad_nombre: "Nacionalidad Test",
        codigo_iso: `T${Date.now() % 100}`
    });

    // 6. TIPOS PAGO
    await verifyEntity("Tipos de Pago", "/tipos-pago", {
        tipo_pago_id: `tp-${Date.now()}`,
        nombre_tipo_pago: "Pago Test"
    });

    // 7. REFERENCIAS
    await verifyEntity("Referencias", "/referencias", {
        referencia_id: `ref-${Date.now()}`,
        nombre_referencia: "Referencia Test"
    });

    // 8. HORARIOS
    await verifyEntity("Horarios", "/horarios", {
        horario_id: `hor-${Date.now()}`,
        nombre_horario: "Horario Test",
        hora_inicio: 8,
        hora_fin: 12
    });

    console.log(`\n${C.BOLD}${C.GREEN}✅ VERIFICACIÓN COMPLETADA${C.RESET}`);
}

main().catch(console.error);
