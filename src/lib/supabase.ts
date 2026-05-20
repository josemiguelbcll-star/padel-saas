import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Cliente Supabase para todo el frontend.
 *
 * SEGURIDAD CRÍTICA — leer antes de tocar este archivo:
 *
 * - Sólo usamos la anon/publishable key (VITE_SUPABASE_ANON_KEY). El
 *   aislamiento entre clubes lo garantiza RLS en Postgres, no el cliente.
 *
 * - NUNCA importes, hardcodees ni referencies SUPABASE_SERVICE_ROLE_KEY
 *   en este archivo ni en ningún otro lugar del frontend. La service_role
 *   key bypassea RLS y sólo puede vivir como secret de Edge Functions.
 *
 * - Si env.ts no pudo validar VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY,
 *   este módulo nunca se llega a inicializar (env.ts lanza primero con
 *   mensaje en castellano).
 */
export const supabase: SupabaseClient = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
