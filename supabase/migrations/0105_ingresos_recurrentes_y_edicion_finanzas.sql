-- ============================================================================
-- 0105_ingresos_recurrentes_y_edicion_finanzas.sql
-- Ingresos Recurrentes + Edición y Eliminación completa de Gastos e Ingresos
-- ============================================================================

BEGIN;

-- 1. Crear tabla ingresos_recurrentes (plantillas de ingresos periódicos)
CREATE TABLE IF NOT EXISTS public.ingresos_recurrentes (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id),

  unidad_id BIGINT NOT NULL REFERENCES public.unidades_negocio(id) ON DELETE RESTRICT,
  concepto VARCHAR(120) NOT NULL,
  monto_estimado DECIMAL(12,2) NOT NULL CHECK (monto_estimado > 0),
  dia_vencimiento SMALLINT NOT NULL CHECK (dia_vencimiento BETWEEN 1 AND 31),
  frecuencia VARCHAR(20) NOT NULL DEFAULT 'mensual' CHECK (frecuencia IN ('mensual')),

  observaciones TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,

  usuario_id UUID NOT NULL REFERENCES public.usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidad del concepto por club
CREATE UNIQUE INDEX IF NOT EXISTS ingresos_recurrentes_unique_concepto
  ON public.ingresos_recurrentes (club_id, lower(concepto));

CREATE INDEX IF NOT EXISTS idx_ingresos_recurrentes_club_activo
  ON public.ingresos_recurrentes (club_id, activo, dia_vencimiento);

CREATE INDEX IF NOT EXISTS idx_ingresos_recurrentes_unidad
  ON public.ingresos_recurrentes (unidad_id);

-- RLS para ingresos_recurrentes
ALTER TABLE public.ingresos_recurrentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingresos_recurrentes_club_isolation ON public.ingresos_recurrentes;
CREATE POLICY ingresos_recurrentes_club_isolation ON public.ingresos_recurrentes
  FOR ALL
  TO authenticated
  USING (club_id = current_club_id())
  WITH CHECK (club_id = current_club_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingresos_recurrentes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ingresos_recurrentes_id_seq TO authenticated;


-- 2. Agregar columna ingreso_recurrente_id a otros_ingresos
ALTER TABLE public.otros_ingresos
  ADD COLUMN IF NOT EXISTS ingreso_recurrente_id BIGINT
  REFERENCES public.ingresos_recurrentes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_otros_ingresos_recurrente
  ON public.otros_ingresos (ingreso_recurrente_id)
  WHERE ingreso_recurrente_id IS NOT NULL;


-- 3. Actualizar CHECK constraints de medio_pago para soportar cuenta_corriente
ALTER TABLE public.otros_ingresos DROP CONSTRAINT IF EXISTS otros_ingresos_medio_pago_check;
ALTER TABLE public.otros_ingresos ADD CONSTRAINT otros_ingresos_medio_pago_check
  CHECK (medio_pago IS NULL OR medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro','cuenta_corriente'));

ALTER TABLE public.gastos DROP CONSTRAINT IF EXISTS gastos_medio_pago_check;
ALTER TABLE public.gastos ADD CONSTRAINT gastos_medio_pago_check
  CHECK (medio_pago IS NULL OR medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro','cuenta_corriente'));

ALTER TABLE public.gasto_cuotas DROP CONSTRAINT IF EXISTS gasto_cuotas_medio_pago_check;
ALTER TABLE public.gasto_cuotas ADD CONSTRAINT gasto_cuotas_medio_pago_check
  CHECK (medio_pago IS NULL OR medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro','cuenta_corriente'));


-- 4. Redefinir fn_registrar_otro_ingreso con soporte para ingreso_recurrente_id y cuenta_corriente
DROP FUNCTION IF EXISTS public.fn_registrar_otro_ingreso(BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.fn_registrar_otro_ingreso(BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT, BIGINT, BIGINT);

CREATE OR REPLACE FUNCTION public.fn_registrar_otro_ingreso(
  p_unidad_id BIGINT,
  p_concepto VARCHAR,
  p_monto DECIMAL,
  p_fecha DATE,
  p_fecha_cobro DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL,
  p_ingreso_recurrente_id BIGINT DEFAULT NULL
)
RETURNS public.otros_ingresos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_unidad public.unidades_negocio;
  v_turno_caja_id BIGINT := NULL;
  v_concepto_trim VARCHAR;
  v_ingreso public.otros_ingresos;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para registrar ingresos.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del ingreso debe ser mayor a 0.';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha del ingreso es obligatoria.';
  END IF;

  v_concepto_trim := TRIM(COALESCE(p_concepto, ''));
  IF LENGTH(v_concepto_trim) = 0 THEN
    RAISE EXCEPTION 'El concepto del ingreso es obligatorio.';
  END IF;
  IF LENGTH(v_concepto_trim) > 200 THEN
    RAISE EXCEPTION 'El concepto puede tener hasta 200 caracteres.';
  END IF;

  IF (p_fecha_cobro IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si cobraste el ingreso, tenés que indicar fecha de cobro Y medio de pago. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro','cuenta_corriente') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  SELECT * INTO v_unidad
  FROM public.unidades_negocio
  WHERE id = p_unidad_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad de negocio no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_unidad.activa THEN
    RAISE EXCEPTION
      'La unidad "%" está desactivada — no se pueden cargar ingresos sobre ella.',
      v_unidad.nombre;
  END IF;

  IF p_fecha_cobro IS NOT NULL THEN
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = p_cuenta_id AND club_id = v_club_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;
    v_es_caja := COALESCE(v_es_caja, FALSE);

    IF v_es_caja THEN
      v_turno_caja_id := current_club_caja_abierta();
      IF v_turno_caja_id IS NULL THEN
        RAISE EXCEPTION
          'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.otros_ingresos (
    club_id, unidad_id, unidad_nombre, unidad_tipo,
    concepto, monto, fecha, fecha_cobro, medio_pago,
    turno_caja_id, cuenta_id, observaciones, usuario_id,
    ingreso_recurrente_id
  ) VALUES (
    v_club_id, v_unidad.id, v_unidad.nombre, v_unidad.tipo,
    v_concepto_trim, p_monto, p_fecha, p_fecha_cobro, p_medio_pago,
    v_turno_caja_id, v_cuenta_id, p_observaciones, v_usuario_id,
    p_ingreso_recurrente_id
  )
  RETURNING * INTO v_ingreso;

  RETURN v_ingreso;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_registrar_otro_ingreso(BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT, BIGINT, BIGINT) TO authenticated;


-- 5. RPC fn_actualizar_otro_ingreso
CREATE OR REPLACE FUNCTION public.fn_actualizar_otro_ingreso(
  p_ingreso_id BIGINT,
  p_unidad_id BIGINT,
  p_concepto VARCHAR,
  p_monto DECIMAL,
  p_fecha DATE,
  p_fecha_cobro DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS public.otros_ingresos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_ingreso public.otros_ingresos;
  v_unidad public.unidades_negocio;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
  v_turno_caja_id BIGINT := NULL;
  v_concepto_trim VARCHAR;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para editar ingresos.';
  END IF;

  SELECT * INTO v_ingreso
  FROM public.otros_ingresos
  WHERE id = p_ingreso_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ingreso no existe o no pertenece a tu club.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha del ingreso es obligatoria.';
  END IF;

  v_concepto_trim := TRIM(COALESCE(p_concepto, ''));
  IF LENGTH(v_concepto_trim) = 0 THEN
    RAISE EXCEPTION 'El concepto es obligatorio.';
  END IF;

  IF (p_fecha_cobro IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION 'Debés indicar fecha de cobro y medio de pago conjuntamente.';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro','cuenta_corriente') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  SELECT * INTO v_unidad
  FROM public.unidades_negocio
  WHERE id = p_unidad_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad de negocio no existe.';
  END IF;

  IF p_fecha_cobro IS NOT NULL THEN
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = p_cuenta_id AND club_id = v_club_id;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;

    IF COALESCE(v_es_caja, FALSE) THEN
      v_turno_caja_id := v_ingreso.turno_caja_id;
      IF v_turno_caja_id IS NULL THEN
        v_turno_caja_id := current_club_caja_abierta();
      END IF;
    END IF;
  END IF;

  UPDATE public.otros_ingresos
  SET unidad_id = v_unidad.id,
      unidad_nombre = v_unidad.nombre,
      unidad_tipo = v_unidad.tipo,
      concepto = v_concepto_trim,
      monto = p_monto,
      fecha = p_fecha,
      fecha_cobro = p_fecha_cobro,
      medio_pago = p_medio_pago,
      cuenta_id = v_cuenta_id,
      turno_caja_id = v_turno_caja_id,
      observaciones = p_observaciones
  WHERE id = p_ingreso_id
  RETURNING * INTO v_ingreso;

  RETURN v_ingreso;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_actualizar_otro_ingreso(BIGINT, BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT, BIGINT) TO authenticated;


-- 6. RPC fn_anular_otro_ingreso
CREATE OR REPLACE FUNCTION public.fn_anular_otro_ingreso(
  p_ingreso_id BIGINT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS public.otros_ingresos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_ingreso public.otros_ingresos;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin') THEN
    RAISE EXCEPTION 'Solo los administradores pueden anular ingresos.';
  END IF;

  SELECT * INTO v_ingreso
  FROM public.otros_ingresos
  WHERE id = p_ingreso_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ingreso no existe o no pertenece a tu club.';
  END IF;

  UPDATE public.otros_ingresos
  SET activo = FALSE,
      observaciones = CASE
        WHEN p_motivo IS NOT NULL AND LENGTH(TRIM(p_motivo)) > 0 THEN
          COALESCE(observaciones || ' | ', '') || 'ANULADO: ' || TRIM(p_motivo)
        ELSE
          COALESCE(observaciones || ' | ', '') || 'ANULADO'
      END
  WHERE id = p_ingreso_id
  RETURNING * INTO v_ingreso;

  RETURN v_ingreso;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_anular_otro_ingreso(BIGINT, TEXT) TO authenticated;


-- 7. RPC fn_actualizar_gasto
CREATE OR REPLACE FUNCTION public.fn_actualizar_gasto(
  p_gasto_id BIGINT,
  p_categoria_id BIGINT,
  p_monto DECIMAL,
  p_fecha_gasto DATE,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_proveedor_id BIGINT DEFAULT NULL,
  p_proveedor_nombre VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS public.gastos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_gasto public.gastos;
  v_categoria public.categorias_gasto;
  v_unidad public.unidades_negocio;
  v_proveedor_nombre VARCHAR;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
  v_turno_caja_id BIGINT := NULL;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para editar gastos.';
  END IF;

  SELECT * INTO v_gasto
  FROM public.gastos
  WHERE id = p_gasto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto no existe o no pertenece a tu club.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  IF p_fecha_gasto IS NULL THEN
    RAISE EXCEPTION 'La fecha del gasto es obligatoria.';
  END IF;

  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION 'Debés indicar fecha de pago y medio de pago conjuntamente.';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro','cuenta_corriente') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  SELECT * INTO v_categoria
  FROM public.categorias_gasto
  WHERE id = p_categoria_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría indicada no existe.';
  END IF;

  SELECT * INTO v_unidad
  FROM public.unidades_negocio
  WHERE id = v_categoria.unidad_id AND club_id = v_club_id;

  IF p_proveedor_id IS NOT NULL THEN
    SELECT nombre INTO v_proveedor_nombre
    FROM public.proveedores
    WHERE id = p_proveedor_id AND club_id = v_club_id;
  ELSE
    v_proveedor_nombre := NULLIF(TRIM(COALESCE(p_proveedor_nombre, '')), '');
  END IF;

  IF p_fecha_pago IS NOT NULL THEN
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = p_cuenta_id AND club_id = v_club_id;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;

    IF COALESCE(v_es_caja, FALSE) THEN
      v_turno_caja_id := v_gasto.turno_caja_id;
      IF v_turno_caja_id IS NULL THEN
        v_turno_caja_id := current_club_caja_abierta();
      END IF;
    END IF;
  END IF;

  UPDATE public.gastos
  SET categoria_id = v_categoria.id,
      categoria_nombre = v_categoria.nombre,
      unidad_id = v_unidad.id,
      unidad_nombre = v_unidad.nombre,
      unidad_tipo = v_unidad.tipo,
      proveedor_id = p_proveedor_id,
      proveedor = v_proveedor_nombre,
      monto = p_monto,
      fecha_gasto = p_fecha_gasto,
      fecha_pago = p_fecha_pago,
      medio_pago = p_medio_pago,
      cuenta_id = v_cuenta_id,
      turno_caja_id = v_turno_caja_id,
      observaciones = p_observaciones
  WHERE id = p_gasto_id
  RETURNING * INTO v_gasto;

  -- Si tiene cuota única vinculada directa, sincronizarla
  UPDATE public.gasto_cuotas
  SET monto = p_monto,
      fecha_vencimiento = COALESCE(p_fecha_pago, p_fecha_gasto),
      fecha_pago = p_fecha_pago,
      medio_pago = p_medio_pago,
      cuenta_id = v_cuenta_id,
      turno_caja_id = v_turno_caja_id
  WHERE gasto_id = p_gasto_id AND numero_cuota = 1 AND total_cuotas = 1;

  RETURN v_gasto;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_actualizar_gasto(BIGINT, BIGINT, DECIMAL, DATE, DATE, VARCHAR, BIGINT, VARCHAR, TEXT, BIGINT) TO authenticated;

COMMIT;
