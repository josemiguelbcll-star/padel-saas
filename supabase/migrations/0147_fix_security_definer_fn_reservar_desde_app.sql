BEGIN;

-- ==============================================================================
-- MIGRACIÓN 0147: Restaurar SECURITY DEFINER en fn_reservar_desde_app (4 args)
-- ==============================================================================
-- Problema
--   La 0126 redefinió public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER)
--   con `SECURITY INVOKER`, pero la función hace
--   `SELECT email FROM auth.users WHERE id = v_jugador_app.auth_user_id`.
--
--   `CREATE OR REPLACE FUNCTION` reasigna los valores por defecto a toda
--   propiedad NO especificada, así que la 0126 pisó el `SECURITY DEFINER` que
--   traían 0117/0118 y la función pasó a ejecutarse con el rol del caller
--   (`authenticated`), que no tiene privilegios sobre `auth.users`
--   (owner: supabase_auth_admin).
--
--   Síntoma: al reservar una cancha desde la app falla con
--   `permission denied for table users` (SQLSTATE 42501) y el hint
--   "GRANT SELECT ON auth.users TO authenticated".
--
-- Fix
--   Volver a SECURITY DEFINER. No se reescribe el cuerpo a propósito: así se
--   preservan intactos los demás atributos y la lógica vigente (evita el riesgo
--   de reintroducir cambios divergentes de los archivos históricos).
--
--   Es seguro: la función valida auth.uid() y que el `jugadores_app` pertenezca
--   al caller antes de tocar nada. Mismo criterio que fn_aceptar_desafio y que
--   el overload de 8 argumentos de la 0129 (ambos ya SECURITY DEFINER).
-- ==============================================================================

ALTER FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER)
  SECURITY DEFINER;

COMMENT ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER) IS
  'Reserva un slot desde la app del jugador. SECURITY DEFINER: debe poder leer auth.users para resolver el email del jugador (restaurado en 0147).';

COMMIT;
