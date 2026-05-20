/**
 * Tipos del dominio.
 *
 * En este sprint sólo modelamos `clubes` y `usuarios` (las únicas tablas
 * que crea la migración 0001). A medida que sumemos tablas iremos
 * extendiendo este archivo (o generándolo desde Supabase con `supabase
 * gen types typescript`).
 *
 * Las definiciones deben coincidir con supabase/migrations/0001_initial_schema.sql.
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
}

export interface Usuario {
  id: string;
  club_id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
  fecha_alta: string;
}
