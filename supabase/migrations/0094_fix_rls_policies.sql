-- Migración 0094: Permitir partidos abiertos sin reserva y corregir políticas RLS

-- 1. Permitir eliminar/cancelar solicitudes de amistad (con DROP IF EXISTS para evitar errores de ya existente)
DROP POLICY IF EXISTS "amigos_delete_own" ON public.jugador_amigos;

CREATE POLICY "amigos_delete_own"
  ON public.jugador_amigos FOR DELETE
  TO authenticated
  USING (
    jugador_app_id_1 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
    OR jugador_app_id_2 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

-- 2. Modificar la tabla partidos_abiertos para permitir reserva_id nulo
ALTER TABLE public.partidos_abiertos ALTER COLUMN reserva_id DROP NOT NULL;

-- 3. Agregar campos manuales para partidos creados sin reserva
ALTER TABLE public.partidos_abiertos ADD COLUMN IF NOT EXISTS club_nombre_manual VARCHAR(100);
ALTER TABLE public.partidos_abiertos ADD COLUMN IF NOT EXISTS cancha_nombre_manual VARCHAR(100);
ALTER TABLE public.partidos_abiertos ADD COLUMN IF NOT EXISTS fecha_manual DATE;
ALTER TABLE public.partidos_abiertos ADD COLUMN IF NOT EXISTS hora_inicio_manual TIME;

-- 4. Corregir política de inserción en partidos_abiertos (soporta reserva_id IS NULL)
DROP POLICY IF EXISTS "partidos_abiertos_insert" ON public.partidos_abiertos;

CREATE POLICY "partidos_abiertos_insert" ON public.partidos_abiertos
    FOR INSERT
    TO authenticated
    WITH CHECK (
        organizador_id IN (
            SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid()
        )
        AND (
            reserva_id IS NULL
            OR reserva_id IN (
                SELECT r.id FROM public.reservas r
                JOIN public.jugadores j ON j.id = r.jugador_id
                JOIN public.jugadores_app ja ON (
                    j.id IN (
                        SELECT jugador_club_id FROM public.jugador_app_club_link WHERE jugador_app_id = ja.id
                    )
                    OR public.fn_normalizar_telefono(j.telefono) = public.fn_normalizar_telefono(ja.telefono)
                )
                WHERE ja.auth_user_id = auth.uid()
            )
        )
    );
