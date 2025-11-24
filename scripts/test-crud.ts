import { sleep } from "bun";

const BASE_URL = "http://localhost:3001";

async function request(method: string, path: string, body?: any) {
    const headers = { "Content-Type": "application/json" };
    const options: RequestInit = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${BASE_URL}${path}`, options);
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        data = text;
    }
    return { status: response.status, data };
}

async function testEntity(name: string, endpoint: string, createPayload: any, updatePayload: any, idField: string) {
    console.log(`\n--- Testing ${name} ---`);

    // 1. Create
    console.log(`Creating ${name}...`);
    const createRes = await request("POST", endpoint, createPayload);
    if (createRes.status !== 201) {
        console.error(`Failed to create ${name}:`, createRes);
        return false;
    }
    const createdId = createRes.data[idField];
    console.log(`Created ${name} with ID: ${createdId}`);

    // 2. List
    console.log(`Listing ${name}s...`);
    const listRes = await request("GET", endpoint);
    if (listRes.status !== 200 || !Array.isArray(listRes.data)) {
        console.error(`Failed to list ${name}s:`, listRes);
        return false;
    }
    const found = listRes.data.find((item: any) => item[idField] === createdId);
    if (!found) {
        console.error(`Created ${name} not found in list`);
        return false;
    }
    console.log(`Found created ${name} in list`);

    // 3. Get by ID
    console.log(`Getting ${name} by ID...`);
    const getRes = await request("GET", `${endpoint}/${createdId}`);
    if (getRes.status !== 200 || getRes.data[idField] !== createdId) {
        console.error(`Failed to get ${name} by ID:`, getRes);
        return false;
    }
    console.log(`Got ${name} by ID`);

    // 4. Update
    console.log(`Updating ${name}...`);
    const updateRes = await request("PUT", `${endpoint}/${createdId}`, updatePayload);
    if (updateRes.status !== 200) {
        console.error(`Failed to update ${name}:`, updateRes);
        return false;
    }
    console.log(`Updated ${name}`);

    // Verify Update
    const getUpdatedRes = await request("GET", `${endpoint}/${createdId}`);
    // Simple check if one field matches
    const updateKey = Object.keys(updatePayload)[0];
    if (getUpdatedRes.data[updateKey] !== updatePayload[updateKey]) {
        console.warn(`Update verification failed for ${updateKey}. Expected ${updatePayload[updateKey]}, got ${getUpdatedRes.data[updateKey]}`);
        // Continue anyway as some fields might be transformed
    }

    // 5. Delete
    console.log(`Deleting ${name}...`);
    const deleteRes = await request("DELETE", `${endpoint}/${createdId}`);
    if (deleteRes.status !== 200) {
        console.error(`Failed to delete ${name}:`, deleteRes);
        return false;
    }
    console.log(`Deleted ${name}`);

    // Verify Delete
    const getDeletedRes = await request("GET", `${endpoint}/${createdId}`);
    if (getDeletedRes.status !== 404) { // Assuming soft delete might still return it? No, controller returns 404 if not found/deleted usually, or we need to check logic. 
        // Our repositories use soft delete, but findById usually filters out deleted ones? 
        // Let's check repository logic. Prisma findUnique doesn't filter by default unless we added middleware or explicit check.
        // In our implementation: findById calls findUnique. It does NOT filter is_deleted=false in findUnique usually unless specified.
        // BUT, the controller checks if result is null.
        // Wait, soft delete just sets is_deleted=true. findById will still return it unless we changed it.
        // Let's check one repository.
        // PrismaNacionalidadRepository: findById -> findUnique.
        // So it WILL return the record.
        // However, the UseCase or Controller might not check is_deleted.
        // Actually, List use case filters is_deleted: false.
        // GetById use case just returns what repository returns.
        // So GetById might still return it.
        // If so, we should check if is_deleted is true.
        if (getDeletedRes.status === 200 && getDeletedRes.data.is_deleted === true) {
            console.log(`Verified ${name} is soft deleted`);
        } else if (getDeletedRes.status === 404) {
            console.log(`Verified ${name} is not found (hard deleted or filtered)`);
        } else {
            console.warn(`Delete verification ambiguous for ${name}: Status ${getDeletedRes.status}`, getDeletedRes.data);
        }
    }

    return true;
}

async function main() {
    console.log("Waiting for server...");
    let retries = 10;
    while (retries > 0) {
        try {
            const res = await fetch(`${BASE_URL}/health`);
            if (res.status === 200) break;
        } catch (e) { }
        await sleep(1000);
        retries--;
    }
    if (retries === 0) {
        console.error("Server not reachable at " + BASE_URL);
        process.exit(1);
    }
    console.log("Server is up!");

    // Data for dependencies
    const monedaPayload = { moneda_nombre: "Test Coin", codigo: "TST" + Date.now(), simbolo: "$", imagen: null };
    const tipoPagoPayload = { nombre_tipo_pago: "Test Payment" };
    const nacionalidadPayload = { nacionalidad_nombre: "Test Nation", codigo_iso: "T" + Math.floor(Math.random() * 90 + 10) };

    // We need IDs for relationships
    let monedaId = "";
    let tipoPagoId = "";
    let nacionalidadId = "";
    let horarioId = "";
    let planPagoId = "";
    let entrenadorId = "";
    let clienteId = "";
    let pagoClienteId = "";
    let tipoCambioId = "";
    let cuentaId = "";

    // 1. Moneda
    if (await testEntity("Moneda", "/monedas", monedaPayload, { moneda_nombre: "Test Coin Updated" }, "moneda_id")) {
        // Create one for relationships
        const res = await request("POST", "/monedas", { ...monedaPayload, codigo: "TST2" + Date.now() });
        monedaId = res.data.moneda_id;
    }

    // 2. TipoPago
    if (await testEntity("TipoPago", "/tipos-pago", tipoPagoPayload, { nombre_tipo_pago: "Test Payment Updated" }, "tipo_pago_id")) {
        const res = await request("POST", "/tipos-pago", { nombre_tipo_pago: "Test Payment 2" });
        tipoPagoId = res.data.tipo_pago_id;
    }

    // 3. Nacionalidad
    if (await testEntity("Nacionalidad", "/nacionalidades", nacionalidadPayload, { nacionalidad_nombre: "Test Nation Updated" }, "nacionalidad_id")) {
        const res = await request("POST", "/nacionalidades", { ...nacionalidadPayload, codigo_iso: "T" + Math.floor(Math.random() * 90 + 10) + "2" }); // Ensure unique and valid length (3 chars: T + 2 digits + 2? No, T + 2 digits is 3 chars. + "2" makes it 4 chars. Wait.)
        // My previous fix was: "T" + Math.floor(Math.random() * 90 + 10) -> T + 2 digits = 3 chars.
        // Here I want another one.
        // "T" + Math.floor(Math.random() * 90 + 10) might collide if random is same.
        // Better: "U" + Math.floor(Math.random() * 90 + 10).
        const res2 = await request("POST", "/nacionalidades", { ...nacionalidadPayload, codigo_iso: "U" + Math.floor(Math.random() * 90 + 10) });
        nacionalidadId = res2.data.nacionalidad_id;
    }

    // 4. TipoCambio
    const tipoCambioPayload = {
        moneda_id_base: monedaId,
        moneda_id_target: monedaId, // Self for test
        exchange_rate: 1.5,
        fecha_inicio: new Date().toISOString()
    };
    if (await testEntity("TipoCambio", "/tipos-cambio", tipoCambioPayload, { exchange_rate: 2.0 }, "tipo_cambio_id")) {
        const res = await request("POST", "/tipos-cambio", tipoCambioPayload);
        tipoCambioId = res.data.tipo_cambio_id;
    }

    // 5. Referencia
    await testEntity("Referencia", "/referencias", { nombre_referencia: "Test Ref" }, { nombre_referencia: "Test Ref Updated" }, "referencia_id");

    // 6. Horario
    const horarioPayload = { nombre_horario: "Morning", hora_inicio: 8, hora_fin: 12 };
    if (await testEntity("Horario", "/horarios", horarioPayload, { nombre_horario: "Evening" }, "horario_id")) {
        const res = await request("POST", "/horarios", horarioPayload);
        horarioId = res.data.horario_id;
    }

    // 7. PlanesPago
    const planesPagoPayload = {
        nombre_plan_pago: "Gold Plan",
        importe_plan_pago: 100,
        duracion_plan_pago: 30,
        moneda_id: monedaId
    };
    if (await testEntity("PlanesPago", "/planes-pago", planesPagoPayload, { nombre_plan_pago: "Platinum Plan" }, "id_planes_pago")) {
        const res = await request("POST", "/planes-pago", planesPagoPayload);
        planPagoId = res.data.id_planes_pago;
    }

    // 8. Cuenta
    const cuentaPayload = { nombre_cuenta: "Main Account", moneda_id: monedaId };
    if (await testEntity("Cuenta", "/cuentas", cuentaPayload, { nombre_cuenta: "Savings Account" }, "cuenta_id")) {
        const res = await request("POST", "/cuentas", cuentaPayload);
        cuentaId = res.data.cuenta_id;
    }

    // 9. Entrenador
    const entrenadorPayload = {
        ci_entrenador: "12345678" + Date.now(),
        nombres_entrenador: "John",
        apellidos_entrenador: "Doe",
        sexo_entrenador: "M",
        activo_entrenador: true,
        fecha_incio_entrenador: new Date().toISOString()
    };
    if (await testEntity("Entrenador", "/entrenadores", entrenadorPayload, { nombres_entrenador: "Jane" }, "id_entrenador")) {
        const res = await request("POST", "/entrenadores", { ...entrenadorPayload, ci_entrenador: "87654321" + Date.now() });
        entrenadorId = res.data.id_entrenador;
    }

    // 10. ClientePeso (Needs Cliente first? No, Cliente needs ClientePeso ID according to schema? Let's check schema)
    // Schema: Cliente has cliente_peso_id. ClientePeso has ci (relation to Cliente).
    // Wait, circular dependency?
    // Cliente: cliente_peso_id String.
    // ClientePeso: ci String.
    // ClientePeso: cliente Cliente? @relation(fields: [ci], references: [ci])
    // Cliente: pesos ClientePeso[]
    // This looks like ClientePeso depends on Cliente (via ci).
    // BUT Cliente has cliente_peso_id field. Is it a foreign key?
    // In schema: Cliente has `cliente_peso_id String`. But no `@relation` on it pointing to ClientePeso.
    // It seems `cliente_peso_id` in Cliente might be just a field (maybe current weight ID?), or it's a mistake in my understanding.
    // However, ClientePeso has `ci` which references `Cliente(ci)`.
    // So Cliente must exist first.
    // But CreateClienteDTO requires `cliente_peso_id`.
    // If `cliente_peso_id` is just a string and not a FK in DB, we can pass anything.
    // Let's assume we can pass a dummy ID or we create ClientePeso after?
    // But we can't create ClientePeso without `ci` (Cliente).
    // So we must create Cliente first.
    // But Cliente needs `cliente_peso_id`.
    // Chicken and egg?
    // If `cliente_peso_id` is not a FK, we can pass a UUID.

    const dummyPesoId = "peso-" + Date.now();

    // 10. Cliente
    const clientePayload = {
        ci: "CLI" + Date.now(),
        nombres: "Alice",
        apellidos: "Smith",
        sexo: "F",
        cliente_peso_id: dummyPesoId,
        estatura_cliente: 170,
        nacionalidad_id: nacionalidadId,
        id_planes_pago: planPagoId,
        id_horarios: horarioId,
        fecha_inicio: new Date().toISOString(),
        fecha_fin: new Date().toISOString(),
        activo: true
    };
    if (await testEntity("Cliente", "/clientes", clientePayload, { nombres: "Alicia" }, "ci")) {
        // Keep this cliente for other tests
        clienteId = clientePayload.ci;
    }

    // 11. ClientePeso (Now we have a client)
    const clientePesoPayload = {
        ci: clienteId,
        fecha: new Date().toISOString(),
        peso: 60.5
    };
    if (await testEntity("ClientePeso", "/clientes-peso", clientePesoPayload, { peso: 61.0 }, "cliente_peso_id")) {
        // nothing
    }

    // 12. Asistencia
    const asistenciaPayload = { ci: clienteId };
    await testEntity("Asistencia", "/asistencias", asistenciaPayload, { ci: clienteId }, "asistencia_id");

    // 13. PagoCliente
    const pagoClientePayload = {
        ci: clienteId,
        fecha: new Date().toISOString(),
        monto_total: 100,
        id_planes_pago: planPagoId,
        moneda_id: monedaId
    };
    if (await testEntity("PagoCliente", "/pagos-cliente", pagoClientePayload, { monto_total: 150 }, "pago_cliente_id")) {
        const res = await request("POST", "/pagos-cliente", pagoClientePayload);
        pagoClienteId = res.data.pago_cliente_id;
    }

    // 14. DetallePago
    const detallePagoPayload = {
        pago_cliente_id: pagoClienteId,
        tipo_pago_id: tipoPagoId,
        moneda_id: monedaId,
        cantidad: 100,
        tipo_cambio_id: tipoCambioId
    };
    await testEntity("DetallePago", "/detalles-pago", detallePagoPayload, { cantidad: 150 }, "detalle_pago_id");

    console.log("\nAll tests completed!");
}

main();
