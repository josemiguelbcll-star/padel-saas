/**
 * Tipos del dominio.
 *
 * Convenciones:
 * - Columnas NOT NULL → tipo simple (string, number, boolean, ...).
 * - Columnas que existen pero pueden ser NULL → `Tipo | null`. NO usamos
 *   el modificador opcional `?` para esos casos: el campo siempre está
 *   presente en la fila devuelta por Supabase, lo que puede pasar es
 *   que valga null. La distinción importa para que el frontend maneje
 *   los dos estados explícitamente.
 * - DECIMAL/NUMERIC se modelan como `number`, alineado con la salida del
 *   tool oficial `supabase gen types typescript`. Para los DECIMAL(12,2)
 *   de moneda que maneja el sistema (pesos), la precisión de Number es
 *   más que suficiente.
 * - TIME se modela como `string` con formato 'HH:MM:SS' (o 'HH:MM' al
 *   enviar — Postgres lo acepta).
 * - TIMESTAMPTZ se modela como `string` (ISO 8601).
 *
 * Sincronizado con:
 *   - 0001_initial_schema.sql       (clubes, usuarios)
 *   - 0003_canchas_y_tarifas.sql    (canchas, tarifas, horarios en clubes)
 */

export type Rol = 'admin' | 'vendedor';
export type PlanClub = 'gratis' | 'crece' | 'club';

export interface Club {
  id: number;
  nombre: string;
  slug: string;
  direccion: string | null;
  ciudad: string | null;
  provincia: string | null;
  telefono: string | null;
  email: string | null;
  plan: PlanClub;
  activo: boolean;
  fecha_alta: string;
  config: Record<string, unknown>;

  // Horarios de operación (agregados en 0003).
  // hora_apertura y hora_cierre arrancan en NULL para el club recién creado;
  // se setean en el onboarding o desde Configuración → Horarios.
  hora_apertura: string | null;
  hora_cierre: string | null;
  // NOT NULL en la DB con DEFAULT 90 y CHECK IN (60, 90, 120, 150, 180, 240).
  duracion_turno_default: number;
}

export interface Usuario {
  id: string;
  club_id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
  fecha_alta: string;
}

export interface Cancha {
  id: number;
  club_id: number;
  nombre: string;
  /** Texto libre: 'cristal', 'cemento', 'muro', etc. NULL si no se especificó. */
  tipo: string | null;
  cubierta: boolean;
  activa: boolean;
  /** Orden de aparición en la grilla. Default 0. */
  orden: number;
}

export interface Tarifa {
  id: number;
  club_id: number;
  nombre: string;
  /** DECIMAL(12,2) en la DB. Modelado como number para ergonomía. */
  monto: number;
  /** TIME 'HH:MM:SS' o NULL. NULL significa "la tarifa aplica a toda hora". */
  desde_hora: string | null;
  /** TIME 'HH:MM:SS' o NULL. NULL significa "la tarifa aplica a toda hora". */
  hasta_hora: string | null;
  /**
   * Array de días donde aplica la tarifa.
   * 1 = lunes, 7 = domingo.
   * NULL significa "la tarifa aplica a todos los días".
   */
  dias_semana: number[] | null;
  /** Mayor número gana. Cuando dos tarifas se superponen, gana la de mayor prioridad. */
  prioridad: number;
  activa: boolean;
}
