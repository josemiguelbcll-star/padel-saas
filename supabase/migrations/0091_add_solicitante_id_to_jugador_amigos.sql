-- 0091 — Agregar columna solicitante_id a jugador_amigos
--
-- Permite identificar inequívocamente quién envió la solicitud de amistad.

ALTER TABLE public.jugador_amigos
ADD COLUMN IF NOT EXISTS solicitante_id UUID REFERENCES public.jugadores_app(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jugador_amigos_solicitante
ON public.jugador_amigos (solicitante_id);

COMMENT ON COLUMN public.jugador_amigos.solicitante_id IS
'ID del jugador_app que inició la solicitud de amistad';
