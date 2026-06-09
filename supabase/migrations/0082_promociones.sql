-- 0082 — Sistema de promociones (respeta REGLA DE ORO del EERR)
--
-- Tipos:
--   descuento_tarifa: rebaja % en el precio de una tarifa (ej: 20% OFF lunes)
--   2x1_producto: llevas 2, pagas 1 de un producto (ej: cerveza 2x1)
--
-- El descuento en tarifa se registra en reservas.descuento_promocion
-- El 2x1 se aplica ajustando cantidad/precio en venta_items
-- RLS: solo admin del club puede crear/editar; cualquier jugador ve las activas

CREATE TABLE public.promociones (
  id                BIGSERIAL PRIMARY KEY,
  club_id           BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL CHECK (tipo IN ('descuento_tarifa', '2x1_producto')),
  nombre            TEXT NOT NULL,
  descripcion       TEXT,

  -- descuento_tarifa: qué tarifa y cuánto descuento
  tarifa_id         BIGINT REFERENCES public.tarifas(id) ON DELETE CASCADE,
  porcentaje_descuento INTEGER CHECK (porcentaje_descuento BETWEEN 1 AND 99),

  -- 2x1_producto: qué producto
  producto_id       BIGINT REFERENCES public.productos(id) ON DELETE CASCADE,

  vigente_desde     DATE,
  vigente_hasta     DATE,
  activo            BOOLEAN NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Validar que descuento_tarifa tiene tarifa_id y porcentaje
  CONSTRAINT check_descuento_tarifa_validacion CHECK (
    CASE WHEN tipo = 'descuento_tarifa'
    THEN tarifa_id IS NOT NULL AND porcentaje_descuento IS NOT NULL
    ELSE TRUE END
  ),
  -- Validar que 2x1_producto tiene producto_id
  CONSTRAINT check_dos_x_uno_producto_validacion CHECK (
    CASE WHEN tipo = '2x1_producto'
    THEN producto_id IS NOT NULL
    ELSE TRUE END
  )
);

CREATE INDEX idx_promociones_club ON public.promociones (club_id);
CREATE INDEX idx_promociones_tipo ON public.promociones (tipo);
CREATE INDEX idx_promociones_activo ON public.promociones (activo) WHERE activo = TRUE;
CREATE INDEX idx_promociones_tarifa ON public.promociones (tarifa_id);
CREATE INDEX idx_promociones_producto ON public.promociones (producto_id);

ALTER TABLE public.promociones ENABLE ROW LEVEL SECURITY;

-- Cualquier jugador ve promociones activas
CREATE POLICY "promo_select_public"
  ON public.promociones FOR SELECT
  TO authenticated
  USING (activo = TRUE);

-- Solo admin del club puede crear/editar/eliminar
CREATE POLICY "promo_insert_admin"
  ON public.promociones FOR INSERT
  TO authenticated
  WITH CHECK (
    club_id IN (
      SELECT club_id FROM public.usuarios
      WHERE id = auth.uid() AND rol IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "promo_update_admin"
  ON public.promociones FOR UPDATE
  TO authenticated
  USING (
    club_id IN (
      SELECT club_id FROM public.usuarios
      WHERE id = auth.uid() AND rol IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "promo_delete_admin"
  ON public.promociones FOR DELETE
  TO authenticated
  USING (
    club_id IN (
      SELECT club_id FROM public.usuarios
      WHERE id = auth.uid() AND rol IN ('admin', 'super_admin')
    )
  );

COMMENT ON TABLE public.promociones IS
  'Promociones por club: descuentos en tarifas y 2x1 en productos. Se aplican al reservar/vender.';

-- ─────────────────────────────────────────────────────────────────────────

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION public.trigger_update_promociones_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_promociones_timestamp
BEFORE UPDATE ON public.promociones
FOR EACH ROW
EXECUTE FUNCTION trigger_update_promociones_timestamp();

-- ─────────────────────────────────────────────────────────────────────────

-- fn_obtener_descuento_tarifa: devuelve el descuento vigente para una tarifa en una fecha
CREATE OR REPLACE FUNCTION public.fn_obtener_descuento_tarifa(
  p_tarifa_id BIGINT,
  p_fecha     DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_descuento INTEGER;
BEGIN
  SELECT porcentaje_descuento INTO v_descuento
  FROM promociones
  WHERE tarifa_id = p_tarifa_id
    AND tipo = 'descuento_tarifa'
    AND activo = TRUE
    AND (vigente_desde IS NULL OR vigente_desde <= p_fecha)
    AND (vigente_hasta IS NULL OR vigente_hasta >= p_fecha)
  ORDER BY vigente_desde DESC NULLS LAST
  LIMIT 1;
  RETURN COALESCE(v_descuento, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_obtener_descuento_tarifa(BIGINT, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────

-- fn_hay_2x1_producto: detecta si hay 2x1 vigente para un producto en una fecha
CREATE OR REPLACE FUNCTION public.fn_hay_2x1_producto(
  p_producto_id BIGINT,
  p_fecha       DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM promociones
    WHERE producto_id = p_producto_id
      AND tipo = '2x1_producto'
      AND activo = TRUE
      AND (vigente_desde IS NULL OR vigente_desde <= p_fecha)
      AND (vigente_hasta IS NULL OR vigente_hasta >= p_fecha)
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_hay_2x1_producto(BIGINT, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────

-- Permisos
GRANT SELECT ON public.promociones TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.promociones TO authenticated;
