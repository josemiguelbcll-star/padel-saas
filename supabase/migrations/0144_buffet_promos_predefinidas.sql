BEGIN;

CREATE TABLE public.promos_buffet (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  nombre VARCHAR(120) NOT NULL CHECK (length(trim(nombre)) > 0),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_promos_buffet_club_activo
  ON public.promos_buffet (club_id, activo);

CREATE OR REPLACE FUNCTION public.fn_actualizar_promo_buffet_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_actualizar_promo_buffet_timestamp
  BEFORE UPDATE ON public.promos_buffet
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_actualizar_promo_buffet_timestamp();

CREATE TABLE public.promo_buffet_items (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  promo_id BIGINT NOT NULL REFERENCES public.promos_buffet(id) ON DELETE CASCADE,
  producto_id BIGINT NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad INT NOT NULL CHECK (cantidad > 0),
  UNIQUE (promo_id, producto_id)
);

CREATE INDEX idx_promo_buffet_items_promo
  ON public.promo_buffet_items (club_id, promo_id);

ALTER TABLE public.promos_buffet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_buffet_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY promos_buffet_select
  ON public.promos_buffet FOR SELECT TO authenticated
  USING (club_id = public.current_club_id());

CREATE POLICY promos_buffet_insert
  ON public.promos_buffet FOR INSERT TO authenticated
  WITH CHECK (
    club_id = public.current_club_id()
    AND (
      public.current_user_rol() = 'admin'
      OR public.has_user_permission('mostrador', 'editar')
    )
  );

CREATE POLICY promos_buffet_update
  ON public.promos_buffet FOR UPDATE TO authenticated
  USING (
    club_id = public.current_club_id()
    AND (
      public.current_user_rol() = 'admin'
      OR public.has_user_permission('mostrador', 'editar')
    )
  )
  WITH CHECK (
    club_id = public.current_club_id()
    AND (
      public.current_user_rol() = 'admin'
      OR public.has_user_permission('mostrador', 'editar')
    )
  );

CREATE POLICY promo_buffet_items_select
  ON public.promo_buffet_items FOR SELECT TO authenticated
  USING (club_id = public.current_club_id());

CREATE POLICY promo_buffet_items_insert
  ON public.promo_buffet_items FOR INSERT TO authenticated
  WITH CHECK (
    club_id = public.current_club_id()
    AND (
      public.current_user_rol() = 'admin'
      OR public.has_user_permission('mostrador', 'editar')
    )
  );

CREATE POLICY promo_buffet_items_update
  ON public.promo_buffet_items FOR UPDATE TO authenticated
  USING (
    club_id = public.current_club_id()
    AND (
      public.current_user_rol() = 'admin'
      OR public.has_user_permission('mostrador', 'editar')
    )
  )
  WITH CHECK (
    club_id = public.current_club_id()
    AND (
      public.current_user_rol() = 'admin'
      OR public.has_user_permission('mostrador', 'editar')
    )
  );

CREATE POLICY promo_buffet_items_delete
  ON public.promo_buffet_items FOR DELETE TO authenticated
  USING (
    club_id = public.current_club_id()
    AND (
      public.current_user_rol() = 'admin'
      OR public.has_user_permission('mostrador', 'editar')
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.promos_buffet TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_buffet_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.promos_buffet_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.promo_buffet_items_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_validar_promo_buffet_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_promo_club_id BIGINT;
  v_producto_club_id BIGINT;
BEGIN
  SELECT club_id INTO v_promo_club_id
  FROM public.promos_buffet
  WHERE id = NEW.promo_id;

  SELECT club_id INTO v_producto_club_id
  FROM public.productos
  WHERE id = NEW.producto_id;

  IF v_promo_club_id IS NULL
     OR v_producto_club_id IS NULL
     OR v_promo_club_id <> NEW.club_id
     OR v_producto_club_id <> NEW.club_id THEN
    RAISE EXCEPTION 'La promo y el producto deben pertenecer al mismo club.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_promo_buffet_item
  BEFORE INSERT OR UPDATE ON public.promo_buffet_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validar_promo_buffet_item();

CREATE OR REPLACE FUNCTION public.fn_guardar_promo_buffet(
  p_promo_id BIGINT,
  p_nombre TEXT,
  p_items JSONB
)
RETURNS public.promos_buffet
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_promo public.promos_buffet;
  v_item JSONB;
  v_producto_id BIGINT;
  v_cantidad INT;
BEGIN
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF trim(COALESCE(p_nombre, '')) = '' OR length(trim(p_nombre)) > 120 THEN
    RAISE EXCEPTION 'Ingresá un nombre de hasta 120 caracteres.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'La promo debe incluir una lista de productos.';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La promo debe incluir al menos un producto.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item(value)
    WHERE COALESCE((value->>'producto_id')::BIGINT, 0) <= 0
       OR COALESCE((value->>'cantidad')::INT, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Cada producto debe tener una cantidad mayor a cero.';
  END IF;

  IF (
    SELECT COUNT(DISTINCT (value->>'producto_id')::BIGINT)
    FROM jsonb_array_elements(p_items) AS item(value)
  ) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'No repitas productos dentro de la promo.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::BIGINT;
    IF NOT EXISTS (
      SELECT 1
      FROM public.productos
      WHERE id = v_producto_id
        AND club_id = v_club_id
        AND activo = TRUE
    ) THEN
      RAISE EXCEPTION 'Uno de los productos no existe, está inactivo o no pertenece a tu club.';
    END IF;
  END LOOP;

  IF p_promo_id IS NULL THEN
    INSERT INTO public.promos_buffet (club_id, nombre)
    VALUES (v_club_id, trim(p_nombre))
    RETURNING * INTO v_promo;
  ELSE
    UPDATE public.promos_buffet
    SET nombre = trim(p_nombre),
        actualizado_en = NOW()
    WHERE id = p_promo_id
      AND club_id = v_club_id
    RETURNING * INTO v_promo;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La promo no existe o no pertenece a tu club.';
    END IF;
  END IF;

  DELETE FROM public.promo_buffet_items
  WHERE promo_id = v_promo.id
    AND club_id = v_club_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.promo_buffet_items (
      club_id, promo_id, producto_id, cantidad
    ) VALUES (
      v_club_id,
      v_promo.id,
      (v_item->>'producto_id')::BIGINT,
      (v_item->>'cantidad')::INT
    );
  END LOOP;

  RETURN v_promo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_guardar_promo_buffet(BIGINT, TEXT, JSONB)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_cargar_promo_buffet_turno(
  p_reserva_id BIGINT,
  p_promo_id BIGINT,
  p_tipo_reparto VARCHAR,
  p_reserva_jugador_id BIGINT,
  p_reserva_jugadores_ids BIGINT[],
  p_solicitud_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_promo public.promos_buffet;
  v_item RECORD;
  v_cantidad INT := 0;
  v_solicitud_item UUID;
BEGIN
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_solicitud_id IS NULL THEN
    RAISE EXCEPTION 'Falta la clave de solicitud para cargar la promo.';
  END IF;

  SELECT * INTO v_promo
  FROM public.promos_buffet
  WHERE id = p_promo_id
    AND club_id = v_club_id
  FOR SHARE;

  IF NOT FOUND OR NOT v_promo.activo THEN
    RAISE EXCEPTION 'La promo no existe o está inactiva.';
  END IF;

  FOR v_item IN
    SELECT producto_id, cantidad
    FROM public.promo_buffet_items
    WHERE promo_id = p_promo_id
      AND club_id = v_club_id
    ORDER BY producto_id
  LOOP
    v_solicitud_item := md5(p_solicitud_id::TEXT || ':' || v_item.producto_id::TEXT)::UUID;

    PERFORM public.fn_cargar_consumo_turno(
      p_reserva_id,
      v_item.producto_id,
      v_item.cantidad,
      p_tipo_reparto,
      p_reserva_jugador_id,
      p_reserva_jugadores_ids,
      v_solicitud_item
    );

    v_cantidad := v_cantidad + 1;
  END LOOP;

  IF v_cantidad = 0 THEN
    RAISE EXCEPTION 'La promo no tiene productos configurados.';
  END IF;

  RETURN v_cantidad;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cargar_promo_buffet_turno(
  BIGINT, BIGINT, VARCHAR, BIGINT, BIGINT[], UUID
) TO authenticated;

COMMIT;
