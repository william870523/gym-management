import "dotenv/config";
import { randomUUID } from "crypto";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

const baseUrl = process.env.REMOTE_BASE_URL ?? "http://localhost:3001";
const adminEmail = process.env.REMOTE_ADMIN_EMAIL ?? "admin@gym.test";
const adminPassword = process.env.REMOTE_ADMIN_PASSWORD ?? "admin123";

async function request<T>(method: HttpMethod, path: string, token: string, body?: any): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText} - ${text}`);
  }

  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  // @ts-expect-error allow empty body
  return undefined as T;
}

async function loginAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin login failed: ${res.status} - ${text}`);
  }
  const data: any = await res.json();
  if (!data.token) throw new Error("No token received on admin login");
  return data.token as string;
}

async function seed() {
  const token = await loginAdmin();
  const stamp = Date.now().toString().slice(-5); // short suffix to avoid unique collisions

  // --- Gyms ---
  const gymMain = await request<any>("POST", "/gyms", token, {
    codigo: `GYM-REM-${stamp}`,
    nombre: "Gym remoto base",
    ciudad: "Remota",
    pais: "CL",
  });
  const gymToUpdate = await request<any>("POST", "/gyms", token, {
    codigo: `GYM-UPD-${stamp}`,
    nombre: "Gym para actualizar",
  });
  const gymToDelete = await request<any>("POST", "/gyms", token, {
    codigo: `GYM-DEL-${stamp}`,
    nombre: "Gym para borrar",
  });
  await request("PUT", `/gyms/${gymToUpdate.gym_id}`, token, { nombre: "Gym actualizado remoto" });
  await request("DELETE", `/gyms/${gymToDelete.gym_id}`, token);

  // --- Devices ---
  let deviceMain: any;
  try {
    deviceMain = await request<any>("GET", "/gyms/devices/device-001", token);
  } catch {
    deviceMain = await request<any>("POST", "/gyms/devices", token, {
      device_id: "device-001",
      gym_id: gymMain.gym_id,
      nombre: "Device Local Bridge",
      tipo: "BACKEND_OFFLINE",
      secret_key: process.env.DEVICE_SECRET ?? "mock-device-token",
      is_active: true,
    });
  }
  const deviceToUpdate = await request<any>("POST", "/gyms/devices", token, {
    gym_id: gymMain.gym_id,
    nombre: "Device a actualizar",
    secret_key: `secret-${stamp}`,
  });
  const deviceToDelete = await request<any>("POST", "/gyms/devices", token, {
    gym_id: gymMain.gym_id,
    nombre: "Device a borrar",
    secret_key: `secret-del-${stamp}`,
  });
  await request("PUT", `/gyms/devices/${deviceToUpdate.device_id}`, token, { nombre: "Device actualizado remoto" });
  await request("DELETE", `/gyms/devices/${deviceToDelete.device_id}`, token);

  // --- Catalogs: Moneda, Nacionalidad, TipoPago, Referencia, Horario ---
  const monedaUsd = await request<any>("POST", "/monedas", token, {
    moneda_nombre: "Dolar Remoto",
    codigo: `USD${stamp}`,
    simbolo: "$",
  });
  const monedaEur = await request<any>("POST", "/monedas", token, {
    moneda_nombre: "Euro Remoto",
    codigo: `EUR${stamp}`,
    simbolo: "€",
  });
  const monedaDel = await request<any>("POST", "/monedas", token, {
    moneda_nombre: "Peso Remoto",
    codigo: `PES${stamp}`,
    simbolo: "$",
  });
  await request("PUT", `/monedas/${monedaEur.moneda_id}`, token, { moneda_nombre: "Euro actualizado remoto" });
  await request("DELETE", `/monedas/${monedaDel.moneda_id}`, token);

  const nac1 = await request<any>("POST", "/nacionalidades", token, {
    nacionalidad_nombre: "Remota Uno",
    codigo_iso: `RU${stamp.slice(-1)}`,
  });
  const nacUpd = await request<any>("POST", "/nacionalidades", token, {
    nacionalidad_nombre: "Remota Dos",
    codigo_iso: `RD${stamp.slice(-1)}`,
  });
  const nacDel = await request<any>("POST", "/nacionalidades", token, {
    nacionalidad_nombre: "Remota Tres",
    codigo_iso: `RT${stamp.slice(-1)}`,
  });
  await request("PUT", `/nacionalidades/${nacUpd.nacionalidad_id}`, token, { nacionalidad_nombre: "Nacionalidad actualizada remoto" });
  await request("DELETE", `/nacionalidades/${nacDel.nacionalidad_id}`, token);

  const tpCash = await request<any>("POST", "/tipos-pago", token, { nombre_tipo_pago: "Efectivo remoto" });
  const tpCard = await request<any>("POST", "/tipos-pago", token, { nombre_tipo_pago: "Tarjeta remota" });
  const tpDel = await request<any>("POST", "/tipos-pago", token, { nombre_tipo_pago: "Eliminar remoto" });
  await request("PUT", `/tipos-pago/${tpCard.tipo_pago_id}`, token, { nombre_tipo_pago: "Tarjeta actualizada remoto" });
  await request("DELETE", `/tipos-pago/${tpDel.tipo_pago_id}`, token);

  const ref1 = await request<any>("POST", "/referencias", token, { nombre_referencia: "Referencia A" });
  const refUpd = await request<any>("POST", "/referencias", token, { nombre_referencia: "Referencia B" });
  const refDel = await request<any>("POST", "/referencias", token, { nombre_referencia: "Referencia C" });
  await request("PUT", `/referencias/${refUpd.referencia_id}`, token, { nombre_referencia: "Referencia B actualizada remoto" });
  await request("DELETE", `/referencias/${refDel.referencia_id}`, token);

  const hor1 = await request<any>("POST", "/horarios", token, {
    nombre_horario: "Manana remota",
    hora_inicio: 6,
    hora_fin: 12,
    gym_id: gymMain.gym_id,
  });
  const horUpd = await request<any>("POST", "/horarios", token, {
    nombre_horario: "Tarde remota",
    hora_inicio: 12,
    hora_fin: 18,
    gym_id: gymMain.gym_id,
  });
  const horDel = await request<any>("POST", "/horarios", token, {
    nombre_horario: "Noche remota",
    hora_inicio: 18,
    hora_fin: 22,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/horarios/${horUpd.horario_id}`, token, { nombre_horario: "Tarde actualizada remoto" });
  await request("DELETE", `/horarios/${horDel.horario_id}`, token);

  // --- Planes de pago & cuentas (dependen de moneda y gym) ---
  const plan1 = await request<any>("POST", "/planes-pago", token, {
    nombre_plan_pago: "Plan remoto mensual",
    importe_plan_pago: 50,
    duracion_plan_pago: 30,
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  const planUpd = await request<any>("POST", "/planes-pago", token, {
    nombre_plan_pago: "Plan actualizar",
    importe_plan_pago: 75,
    duracion_plan_pago: 45,
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  const planDel = await request<any>("POST", "/planes-pago", token, {
    nombre_plan_pago: "Plan borrar",
    importe_plan_pago: 30,
    duracion_plan_pago: 15,
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/planes-pago/${planUpd.id_planes_pago}`, token, { nombre_plan_pago: "Plan actualizado remoto" });
  await request("DELETE", `/planes-pago/${planDel.id_planes_pago}`, token);

  const cuenta1 = await request<any>("POST", "/cuentas", token, {
    nombre_cuenta: "Caja remota",
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  const cuentaUpd = await request<any>("POST", "/cuentas", token, {
    nombre_cuenta: "Banco remoto",
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  const cuentaDel = await request<any>("POST", "/cuentas", token, {
    nombre_cuenta: "Eliminar cuenta",
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/cuentas/${cuentaUpd.cuenta_id}`, token, { nombre_cuenta: "Banco actualizado remoto" });
  await request("DELETE", `/cuentas/${cuentaDel.cuenta_id}`, token);

  // --- Entrenadores ---
  const entrenador1 = await request<any>("POST", "/entrenadores", token, {
    ci_entrenador: `900${stamp}1`,
    nombres_entrenador: "Ana Remota",
    apellidos_entrenador: "Trainer",
    sexo_entrenador: "F",
    direccion_entrenador: "Remota 1",
    activo_entrenador: true,
    fecha_incio_entrenador: new Date().toISOString(),
    gym_id: gymMain.gym_id,
  });
  const entrenadorUpd = await request<any>("POST", "/entrenadores", token, {
    ci_entrenador: `900${stamp}2`,
    nombres_entrenador: "Luis Remoto",
    apellidos_entrenador: "Trainer",
    sexo_entrenador: "M",
    activo_entrenador: true,
    fecha_incio_entrenador: new Date().toISOString(),
    gym_id: gymMain.gym_id,
  });
  const entrenadorDel = await request<any>("POST", "/entrenadores", token, {
    ci_entrenador: `900${stamp}3`,
    nombres_entrenador: "Borrar Remoto",
    apellidos_entrenador: "Trainer",
    sexo_entrenador: "M",
    activo_entrenador: true,
    fecha_incio_entrenador: new Date().toISOString(),
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/entrenadores/${entrenadorUpd.id_entrenador}`, token, { nombres_entrenador: "Luis actualizado remoto" });
  await request("DELETE", `/entrenadores/${entrenadorDel.id_entrenador}`, token);

  // --- Tipo cambio (usa monedas) ---
  const tc1 = await request<any>("POST", "/tipos-cambio", token, {
    moneda_id_base: monedaUsd.moneda_id,
    moneda_id_target: monedaEur.moneda_id,
    exchange_rate: 0.9,
    fecha_inicio: new Date().toISOString(),
  });
  const tcUpd = await request<any>("POST", "/tipos-cambio", token, {
    moneda_id_base: monedaEur.moneda_id,
    moneda_id_target: monedaUsd.moneda_id,
    exchange_rate: 1.1,
    fecha_inicio: new Date().toISOString(),
  });
  const tcDel = await request<any>("POST", "/tipos-cambio", token, {
    moneda_id_base: monedaUsd.moneda_id,
    moneda_id_target: monedaUsd.moneda_id,
    exchange_rate: 1,
    fecha_inicio: new Date().toISOString(),
  });
  await request("PUT", `/tipos-cambio/${tcUpd.tipo_cambio_id}`, token, { exchange_rate: 1.2 });
  await request("DELETE", `/tipos-cambio/${tcDel.tipo_cambio_id}`, token);

  // --- Users ---
  const userKeep = await request<any>("POST", "/users", token, {
    user_nombre: "Usuario remoto",
    user_email: `user-${stamp}@test.com`,
    password: "remote123",
    role: "user",
    gym_id: gymMain.gym_id,
  });
  const userUpd = await request<any>("POST", "/users", token, {
    user_nombre: "Usuario actualizar",
    user_email: `user-upd-${stamp}@test.com`,
    password: "remote123",
    role: "user",
    gym_id: gymMain.gym_id,
  });
  const userDel = await request<any>("POST", "/users", token, {
    user_nombre: "Usuario borrar",
    user_email: `user-del-${stamp}@test.com`,
    password: "remote123",
    role: "user",
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/users/${userUpd.user_id}`, token, { user_nombre: "Usuario actualizado remoto" });
  await request("DELETE", `/users/${userDel.user_id}`, token);

  // --- Clientes ---
  const pesoId1 = randomUUID();
  const pesoId2 = randomUUID();
  const pesoId3 = randomUUID();
  const cliente1 = await request<any>("POST", "/clientes", token, {
    ci: `800${stamp}1`,
    nombres: "Cliente Uno remoto",
    apellidos: "Test",
    sexo: "M",
    cliente_peso_id: pesoId1,
    estatura_cliente: 175,
    nacionalidad_id: nac1.nacionalidad_id,
    id_planes_pago: plan1.id_planes_pago,
    fecha_inicio: new Date().toISOString(),
    fecha_fin: new Date(Date.now() + 30 * 86400000).toISOString(),
    activo: true,
    id_horarios: hor1.horario_id,
    gym_id: gymMain.gym_id,
  });
  const clienteUpd = await request<any>("POST", "/clientes", token, {
    ci: `800${stamp}2`,
    nombres: "Cliente Dos remoto",
    apellidos: "Test",
    sexo: "F",
    cliente_peso_id: pesoId2,
    estatura_cliente: 165,
    nacionalidad_id: nac1.nacionalidad_id,
    id_planes_pago: plan1.id_planes_pago,
    fecha_inicio: new Date().toISOString(),
    fecha_fin: new Date(Date.now() + 60 * 86400000).toISOString(),
    activo: true,
    id_horarios: hor1.horario_id,
    gym_id: gymMain.gym_id,
  });
  const clienteDel = await request<any>("POST", "/clientes", token, {
    ci: `800${stamp}3`,
    nombres: "Cliente Tres remoto",
    apellidos: "Test",
    sexo: "M",
    cliente_peso_id: pesoId3,
    estatura_cliente: 180,
    nacionalidad_id: nac1.nacionalidad_id,
    id_planes_pago: plan1.id_planes_pago,
    fecha_inicio: new Date().toISOString(),
    fecha_fin: new Date(Date.now() + 15 * 86400000).toISOString(),
    activo: true,
    id_horarios: hor1.horario_id,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/clientes/${clienteUpd.ci}`, token, { nombres: "Cliente Dos actualizado remoto" });
  await request("DELETE", `/clientes/${clienteDel.ci}`, token);

  // --- Cliente Peso ---
  const cp1 = await request<any>("POST", "/cliente-pesos", token, {
    ci: cliente1.ci,
    fecha: new Date().toISOString(),
    peso: 80.5,
    gym_id: gymMain.gym_id,
  });
  const cpUpd = await request<any>("POST", "/cliente-pesos", token, {
    ci: clienteUpd.ci,
    fecha: new Date().toISOString(),
    peso: 65.2,
    gym_id: gymMain.gym_id,
  });
  const cpDel = await request<any>("POST", "/cliente-pesos", token, {
    ci: clienteUpd.ci,
    fecha: new Date().toISOString(),
    peso: 66.1,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/cliente-pesos/${cpUpd.cliente_peso_id}`, token, { peso: 64.8 });
  await request("DELETE", `/cliente-pesos/${cpDel.cliente_peso_id}`, token);

  // --- Asistencias ---
  const asis1 = await request<any>("POST", "/asistencias", token, {
    ci: cliente1.ci,
    gym_id: gymMain.gym_id,
  });
  const asisUpd = await request<any>("POST", "/asistencias", token, {
    ci: clienteUpd.ci,
    gym_id: gymMain.gym_id,
  });
  const asisDel = await request<any>("POST", "/asistencias", token, {
    ci: clienteUpd.ci,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/asistencias/${asisUpd.asistencia_id}`, token, { gym_id: gymMain.gym_id });
  await request("DELETE", `/asistencias/${asisDel.asistencia_id}`, token);

  // --- Pagos y detalles ---
  const pago1 = await request<any>("POST", "/pagos-cliente", token, {
    ci: cliente1.ci,
    fecha: new Date().toISOString(),
    monto_total: 100,
    id_planes_pago: plan1.id_planes_pago,
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  const pagoUpd = await request<any>("POST", "/pagos-cliente", token, {
    ci: clienteUpd.ci,
    fecha: new Date().toISOString(),
    monto_total: 120,
    id_planes_pago: plan1.id_planes_pago,
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  const pagoDel = await request<any>("POST", "/pagos-cliente", token, {
    ci: clienteUpd.ci,
    fecha: new Date().toISOString(),
    monto_total: 70,
    id_planes_pago: plan1.id_planes_pago,
    moneda_id: monedaUsd.moneda_id,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/pagos-cliente/${pagoUpd.pago_cliente_id}`, token, { monto_total: 130 });
  await request("DELETE", `/pagos-cliente/${pagoDel.pago_cliente_id}`, token);

  const det1 = await request<any>("POST", "/detalles-pago", token, {
    pago_cliente_id: pago1.pago_cliente_id,
    tipo_pago_id: tpCash.tipo_pago_id,
    moneda_id: monedaUsd.moneda_id,
    cantidad: 100,
    tipo_cambio_id: tc1.tipo_cambio_id,
    gym_id: gymMain.gym_id,
  });
  const detUpd = await request<any>("POST", "/detalles-pago", token, {
    pago_cliente_id: pagoUpd.pago_cliente_id,
    tipo_pago_id: tpCard.tipo_pago_id,
    moneda_id: monedaUsd.moneda_id,
    cantidad: 120,
    tipo_cambio_id: tc1.tipo_cambio_id,
    gym_id: gymMain.gym_id,
    cuenta_id: cuenta1.cuenta_id,
  });
  const detDel = await request<any>("POST", "/detalles-pago", token, {
    pago_cliente_id: pagoUpd.pago_cliente_id,
    tipo_pago_id: tpCard.tipo_pago_id,
    moneda_id: monedaUsd.moneda_id,
    cantidad: 20,
    tipo_cambio_id: tc1.tipo_cambio_id,
    gym_id: gymMain.gym_id,
  });
  await request("PUT", `/detalles-pago/${detUpd.detalle_pago_id}`, token, { cantidad: 125 });
  await request("DELETE", `/detalles-pago/${detDel.detalle_pago_id}`, token);

  console.log("Seed remoto finalizado", {
    gymMain: gymMain.gym_id,
    deviceMain: deviceMain.device_id,
    monedaUsd: monedaUsd.moneda_id,
    nacionalidad: nac1.nacionalidad_id,
    tipoPago: tpCash.tipo_pago_id,
    plan: plan1.id_planes_pago,
    cuenta: cuenta1.cuenta_id,
    cliente: cliente1.ci,
    pago: pago1.pago_cliente_id,
    detalle: det1.detalle_pago_id,
  });
}

seed().catch((err) => {
  console.error("Seed remoto fallo:", err);
  process.exit(1);
});
