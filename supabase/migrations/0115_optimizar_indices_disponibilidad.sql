-- ==============================================================================
-- MIGRACIÓN 0115: Índices optimizados para búsqueda ultra-rápida de canchas
-- ==============================================================================

-- 1. Índices para reservas activas por cancha y fecha
CREATE INDEX IF NOT EXISTS idx_reservas_disp_lookup
  ON public.reservas (cancha_id, fecha, estado, hora_inicio, hora_fin)
  WHERE estado NOT IN ('cancelada', 'rechazada');

CREATE INDEX IF NOT EXISTS idx_reservas_club_fecha
  ON public.reservas (club_id, fecha)
  WHERE estado NOT IN ('cancelada', 'rechazada');

-- 2. Índices para turnos fijos activos (usan hora_inicio y duracion_min)
CREATE INDEX IF NOT EXISTS idx_turnos_fijos_cancha_dia
  ON public.turnos_fijos (cancha_id, dia_semana, hora_inicio, duracion_min)
  WHERE activo = TRUE;

-- 3. Índices para clases activas (usan hora_inicio y duracion_min)
CREATE INDEX IF NOT EXISTS idx_clases_cancha_activa
  ON public.clases (cancha_id, hora_inicio, duracion_min)
  WHERE activa = TRUE;

-- 4. Índices para canchas por club
CREATE INDEX IF NOT EXISTS idx_canchas_club_activa_lookup
  ON public.canchas (club_id, activa, orden);

-- 5. Índices para clubes públicos
CREATE INDEX IF NOT EXISTS idx_clubes_publico_lookup
  ON public.clubes (slug, ciudad, estado, activo, perfil_publico_activo);
