-- Migración 0087: Configuración segura de Mercado Pago para los clubes
-- Crea la tabla para almacenar tokens de Mercado Pago de forma privada y actualiza la vista pública de clubes.

-- 1. Tabla de credenciales privadas de Mercado Pago
CREATE TABLE IF NOT EXISTS public.club_mercadopago_config (
    club_id BIGINT PRIMARY KEY REFERENCES public.clubes(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    public_key TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comentario explicativo
COMMENT ON TABLE public.club_mercadopago_config IS 
  'Almacena de forma segura las credenciales privadas de Mercado Pago para cada club. Protegido por RLS para evitar fugas.';

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.club_mercadopago_config ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de seguridad para administradores del club
CREATE POLICY "club_mp_config_select_admin" ON public.club_mercadopago_config
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IN (
            SELECT id FROM public.usuarios 
            WHERE club_id = public.club_mercadopago_config.club_id AND rol = 'admin' AND activo = true
        )
    );

CREATE POLICY "club_mp_config_insert_admin" ON public.club_mercadopago_config
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() IN (
            SELECT id FROM public.usuarios 
            WHERE club_id = public.club_mercadopago_config.club_id AND rol = 'admin' AND activo = true
        )
    );

CREATE POLICY "club_mp_config_update_admin" ON public.club_mercadopago_config
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() IN (
            SELECT id FROM public.usuarios 
            WHERE club_id = public.club_mercadopago_config.club_id AND rol = 'admin' AND activo = true
        )
    );

CREATE POLICY "club_mp_config_delete_admin" ON public.club_mercadopago_config
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() IN (
            SELECT id FROM public.usuarios 
            WHERE club_id = public.club_mercadopago_config.club_id AND rol = 'admin' AND activo = true
        )
    );

-- Otorgar permisos básicos en la tabla
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_mercadopago_config TO authenticated;
GRANT SELECT ON public.club_mercadopago_config TO service_role;

-- 4. Recrear la vista pública de clubes para incluir configuraciones públicas de pago
DROP VIEW IF EXISTS public.v_clubes_publicos;

CREATE VIEW public.v_clubes_publicos
  WITH (security_invoker = false)
AS
SELECT
  c.id,
  c.nombre,
  c.slug,
  c.descripcion,
  c.direccion,
  c.ciudad,
  c.provincia,
  c.telefono,
  c.email,
  c.hora_apertura,
  c.hora_cierre,
  c.logo_path,
  c.color_primario_hsl,
  c.lat,
  c.lng,
  c.instagram,
  c.website,
  -- Foto de portada (subquery escalar — NULL si no hay fotos)
  (
    SELECT f.url
    FROM public.club_fotos f
    WHERE f.club_id = c.id AND f.es_portada = TRUE
    LIMIT 1
  ) AS portada_url,
  -- Campos públicos de seña derivados de config
  COALESCE((c.config->'deposito'->>'obligatorio')::boolean, false) AS sena_obligatoria,
  c.config->'deposito'->>'tipo' AS sena_tipo,
  (c.config->'deposito'->>'valor')::numeric AS sena_valor,
  c.config->'deposito'->>'transferencia_alias' AS sena_alias,
  COALESCE((c.config->'mercadopago'->>'conectado')::boolean, false) AS mercadopago_habilitado
FROM public.clubes c
WHERE c.perfil_publico_activo = TRUE
  AND c.estado IN ('trial', 'activo')
  AND c.activo = TRUE;

-- Comentario sobre la vista
COMMENT ON VIEW public.v_clubes_publicos IS 
  'Vista pública de clubes que expone configuración de seña pública pero protege los secretos y tokens de Mercado Pago.';

-- Otorgar permisos de lectura a anon y authenticated en la vista
GRANT SELECT ON public.v_clubes_publicos TO anon;
GRANT SELECT ON public.v_clubes_publicos TO authenticated;
