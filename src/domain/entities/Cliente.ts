// src/domain/entities/Cliente.ts
export interface Cliente {
  ci: string;
  nombres: string;
  apellidos: string;
  sexo: string;
  foto_cliente?: Uint8Array | null;
  cliente_peso_id: string;
  estatura_cliente: number;
  direccion?: string | null;
  telefono?: number | null;
  nacionalidad_id: string;
  correo?: string | null;
  objetivo?: string | null;
  id_planes_pago: string;
  id_entrenador?: string | null;
  fecha_inicio: Date;
  fecha_fin: Date;
  activo: boolean;
  id_horarios: string;
  referencia_id?: string | null;
  source_device?: string | null;
  created_at?: Date | null;
  updated_at?: Date;
  deleted_at?: Date | null;
  is_deleted?: boolean;
  version: number;
  gym_id?: string | null;
}
