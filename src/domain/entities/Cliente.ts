// src/domain/entities/Cliente.ts
export interface Cliente {
  ci: string;
  nombres: string;
  apellidos: string;
  sexo: string;
  foto_cliente?: Uint8Array | null;
  cliente_peso_id?: string | null;
  estatura_cliente: number;
  direccion?: string | null;
  telefono?: number | null;
  nacionalidad_id: string;
  correo?: string | null;
  objetivo?: string | null;
  id_planes_pago?: string | null;
  id_entrenador?: string | null;
  fecha_inicio: Date;
  fecha_fin: Date;
  activo: boolean;
  id_horarios?: string | null;
  referencia_id?: string | null;
  // R5.3: categoría del cliente para el descuento (NUEVO | VIEJO).
  categoria?: string;
  source_device?: string | null;
  created_at?: Date | null;
  updated_at?: Date;
  deleted_at?: Date | null;
  is_deleted?: boolean;
  version: number;
  gym_id?: string | null;
  // Proyección de lectura durante la migración al historial contractual.
  membresia_id?: string | null;
  membresia_estado?: string | null;
  membresia_precio?: number | null;
  membresia_importe_pagado?: number | null;
  membresia_saldo_pendiente?: number | null;
}
