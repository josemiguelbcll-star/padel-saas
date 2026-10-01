-- ============================================================================
-- 0123_clases_alumnos_consumos_y_consumos_individuales.sql
-- 1. Soporte de consumos individuales vs grupales en turnos (reserva_consumos).
-- 2. Alumnos fijos semanales para clases (clase_alumnos_fijos).
-- 3. Alumnos asignados por fecha en ocurrencias de clases (clase_ocurrencia_alumnos).
-- 4. Consumos en clases con asignación individual o grupal (clase_consumos).
-- 5. Cobro individualizado por alumno en clases (clase_cobros y RPCs).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CONSUMOS INDIVIDUALES EN TURNOS (RESERVAS)
-- ============================================================================

ALTER TABLE reserva_consumos
  ADD COLUMN IF NOT EXISTS reserva_jugador_id BIGINT REFERENCES reserva_jugadores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jugador_id BIGINT REFERENCES jugadores(id) ON DELETE SET NULL;

-- Permitir tipo_reparto = 'individual' además de 'general' y 'partido'
ALTER TABLE reserva_consumos DROP CONSTRAINT IF EXISTS reserva_consumos_tipo_reparto_check;
ALTER TABLE reserva_consumos
  ADD CONSTRAINT reserva_consumos_tipo_reparto_check
  CHECK (tipo_reparto IN ('general', 'partido', 'individual'));

CREATE INDEX IF NOT EXISTS idx_reserva_consumos_reserva_jugador
  ON reserva_consumos(reserva_jugador_id)
  WHERE reserva_jugador_id IS NOT NULL;

-- Redefinir fn_cargar_consumo_turno para aceptar p_reserva_jugador_id opcional
DROP FUNCTION IF EXISTS fn_cargar_consumo_turno(BIGINT, BIGINT, INT, VARCHAR);
DROP FUNCTION IF EXISTS fn_cargar_consumo_turno(BIGINT, BIGINT, INT, VARCHAR, BIGINT);

CREATE OR REPLACE FUNCTION fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR DEFAULT 'general',
  p_reserva_jugador_id BIGINT DEFAULT NULL
)
RETURNS reserva_consumos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva reservas;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_consumo reserva_consumos;
  v_jugador_id BIGINT := NULL;
  v_tipo_reparto_final VARCHAR;
  v_stock INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a un turno cerrado.';
  END IF;

  -- Resolver producto bajo lock
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o está inactivo.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
  END IF;

  -- Debounce anti-doble-submit (2 segundos)
  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE club_id      = v_club_id
    AND reserva_id   = p_reserva_id
    AND producto_id  = v_producto.id
    AND cantidad     = p_cantidad
    AND tipo_reparto = COALESCE(p_tipo_reparto, 'general')
    AND (
      (p_reserva_jugador_id IS NULL AND reserva_jugador_id IS NULL)
      OR reserva_jugador_id = p_reserva_jugador_id
    )
    AND usuario_id   = v_usuario_id
    AND fecha_hora  >= NOW() - INTERVAL '2 seconds'
  ORDER BY fecha_hora DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_consumo;
  END IF;

  -- Calcular stock bajo el lock desde movimientos_stock
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- Si se asigna a una persona puntual
  IF p_reserva_jugador_id IS NOT NULL THEN
    SELECT jugador_id INTO v_jugador_id
    FROM reserva_jugadores
    WHERE id = p_reserva_jugador_id AND reserva_id = p_reserva_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La persona indicada no pertenece a este turno.';
    END IF;
    v_tipo_reparto_final := 'individual';
  ELSE
    v_tipo_reparto_final := COALESCE(p_tipo_reparto, 'general');
    IF v_tipo_reparto_final NOT IN ('general', 'partido') THEN
      v_tipo_reparto_final := 'general';
    END IF;
  END IF;

  -- Insertar consumo
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto, linea,
    reserva_jugador_id, jugador_id
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    v_tipo_reparto_final, v_producto.linea,
    p_reserva_jugador_id, v_jugador_id
  )
  RETURNING * INTO v_consumo;

  -- Movimiento de stock
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_turno',
    NULL, v_consumo.id, v_usuario_id
  );

  RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cargar_consumo_turno(BIGINT, BIGINT, INT, VARCHAR, BIGINT) TO authenticated;


-- ============================================================================
-- 2. ALUMNOS FIJOS SEMANALES EN CLASES (clase_alumnos_fijos)
-- ============================================================================

CREATE TABLE IF NOT EXISTS clase_alumnos_fijos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id) ON DELETE CASCADE,
  clase_id BIGINT NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
  jugador_id BIGINT REFERENCES jugadores(id) ON DELETE SET NULL,
  nombre_libre VARCHAR(100),
  monto_cuota DECIMAL(12,2) DEFAULT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clase_alumnos_fijos_clase
  ON clase_alumnos_fijos(club_id, clase_id);

ALTER TABLE clase_alumnos_fijos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clase_alumnos_fijos_all ON clase_alumnos_fijos;
CREATE POLICY clase_alumnos_fijos_all ON clase_alumnos_fijos
  FOR ALL TO authenticated
  USING (club_id = current_club_id())
  WITH CHECK (club_id = current_club_id());


-- ============================================================================
-- 3. ALUMNOS POR FECHA / OCURRENCIA (clase_ocurrencia_alumnos)
-- ============================================================================

CREATE TABLE IF NOT EXISTS clase_ocurrencia_alumnos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id) ON DELETE CASCADE,
  clase_id BIGINT NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  jugador_id BIGINT REFERENCES jugadores(id) ON DELETE SET NULL,
  nombre_libre VARCHAR(100),
  monto_clase DECIMAL(12,2) NOT NULL DEFAULT 0,
  cuota_fija DECIMAL(12,2) DEFAULT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clase_ocurrencia_alumnos_clase_fecha
  ON clase_ocurrencia_alumnos(club_id, clase_id, fecha);

ALTER TABLE clase_ocurrencia_alumnos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clase_ocurrencia_alumnos_all ON clase_ocurrencia_alumnos;
CREATE POLICY clase_ocurrencia_alumnos_all ON clase_ocurrencia_alumnos
  FOR ALL TO authenticated
  USING (club_id = current_club_id())
  WITH CHECK (club_id = current_club_id());


-- ============================================================================
-- 4. CONSUMOS EN CLASES (clase_consumos)
-- ============================================================================

CREATE TABLE IF NOT EXISTS clase_consumos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id) ON DELETE CASCADE,
  clase_id BIGINT NOT NULL REFERENCES clases(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  clase_alumno_id BIGINT REFERENCES clase_ocurrencia_alumnos(id) ON DELETE SET NULL,
  producto_id BIGINT NOT NULL REFERENCES productos(id),
  producto_nombre VARCHAR(150) NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL CHECK (precio_unitario >= 0),
  costo_unitario DECIMAL(12,2),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
  linea VARCHAR(20) NOT NULL DEFAULT 'buffet' CHECK (linea IN ('buffet', 'shop')),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clase_consumos_clase_fecha
  ON clase_consumos(club_id, clase_id, fecha);

ALTER TABLE clase_consumos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clase_consumos_all ON clase_consumos;
CREATE POLICY clase_consumos_all ON clase_consumos
  FOR ALL TO authenticated
  USING (club_id = current_club_id())
  WITH CHECK (club_id = current_club_id());


-- Permitir fuentes 'consumo_clase' y 'reposicion_consumo_clase' en movimientos_stock
ALTER TABLE movimientos_stock
  ADD COLUMN IF NOT EXISTS clase_consumo_id BIGINT REFERENCES clase_consumos(id) ON DELETE SET NULL;

ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS mov_stock_fuente_enum;
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_fuente_enum CHECK (
    fuente IN (
      'compra_manual',
      'venta',
      'ajuste',
      'compra_bot_whatsapp',
      'consumo_turno',
      'reposicion_consumo',
      'consumo_clase',
      'reposicion_consumo_clase'
    )
  );

ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS mov_stock_coherencia_fuente;
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_coherencia_fuente CHECK (
    (fuente = 'venta' AND cantidad < 0 AND venta_id IS NOT NULL)
    OR (fuente IN ('consumo_turno', 'consumo_clase') AND cantidad < 0)
    OR (fuente IN ('reposicion_consumo', 'reposicion_consumo_clase') AND cantidad > 0)
    OR (fuente IN ('compra_manual','compra_bot_whatsapp') AND cantidad > 0)
    OR (fuente = 'ajuste')
  );


-- RPC: fn_cargar_consumo_clase
CREATE OR REPLACE FUNCTION fn_cargar_consumo_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_clase_alumno_id BIGINT DEFAULT NULL
)
RETURNS clase_consumos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_consumo clase_consumos;
  v_stock INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clases WHERE id = p_clase_id AND club_id = v_club_id) THEN
    RAISE EXCEPTION 'La clase no existe.';
  END IF;

  -- Lock exclusivo del producto
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o está inactivo.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
  END IF;

  -- Calcular stock bajo el lock desde movimientos_stock
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- Insertar consumo
  INSERT INTO clase_consumos (
    club_id, clase_id, fecha,
    clase_alumno_id, producto_id, producto_nombre,
    precio_unitario, costo_unitario, cantidad,
    subtotal, linea, usuario_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha,
    p_clase_alumno_id, v_producto.id, v_producto.nombre,
    v_producto.precio, v_producto.costo, p_cantidad,
    v_producto.precio * p_cantidad, v_producto.linea, v_usuario_id
  )
  RETURNING * INTO v_consumo;

  -- Registrar movimiento de stock
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    clase_consumo_id, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_clase',
    v_consumo.id, v_usuario_id
  );

  RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cargar_consumo_clase(BIGINT, DATE, BIGINT, INT, BIGINT) TO authenticated;


-- RPC: fn_quitar_consumo_clase
CREATE OR REPLACE FUNCTION fn_quitar_consumo_clase(
  p_consumo_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_consumo clase_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  SELECT * INTO v_consumo
  FROM clase_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe.';
  END IF;

  -- Registrar movimiento de reposición
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo_clase',
    v_usuario_id
  );

  DELETE FROM clase_consumos WHERE id = p_consumo_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_quitar_consumo_clase(BIGINT) TO authenticated;


-- ============================================================================
-- 5. COBROS EN CLASES POR ALUMNO (clase_cobros)
-- ============================================================================

ALTER TABLE clase_cobros
  ADD COLUMN IF NOT EXISTS clase_alumno_id BIGINT REFERENCES clase_ocurrencia_alumnos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jugador_id BIGINT REFERENCES jugadores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS monto_clase DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_consumo DECIMAL(12,2) DEFAULT 0;

-- RPC: fn_cobrar_alumno_clase
CREATE OR REPLACE FUNCTION fn_cobrar_alumno_clase(
  p_clase_alumno_id BIGINT,
  p_medio_pago VARCHAR,
  p_monto DECIMAL,
  p_monto_clase DECIMAL DEFAULT NULL,
  p_monto_consumo DECIMAL DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS clase_cobros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_alumno clase_ocurrencia_alumnos%ROWTYPE;
  v_cobro clase_cobros;
  v_cuenta_id BIGINT;
  v_turno_caja_id BIGINT := NULL;
  v_monto_clase DECIMAL(12,2);
  v_monto_consumo DECIMAL(12,2);
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_alumno
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El alumno de la clase no existe.';
  END IF;

  -- Resolver cuenta
  IF p_cuenta_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id) THEN
      RAISE EXCEPTION 'La cuenta indicada no pertenece al club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT cuenta_id INTO v_cuenta_id
    FROM medio_cuenta_default
    WHERE club_id = v_club_id AND medio_pago = p_medio_pago;
  END IF;

  -- Resolver caja si es efectivo
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
  END IF;

  -- Desglose
  IF p_monto_clase IS NOT NULL AND p_monto_consumo IS NOT NULL THEN
    v_monto_clase := p_monto_clase;
    v_monto_consumo := p_monto_consumo;
  ELSE
    v_monto_clase := p_monto;
    v_monto_consumo := 0;
  END IF;

  INSERT INTO clase_cobros (
    club_id, clase_id, fecha, monto,
    medio_pago, observaciones, usuario_id,
    cuenta_id, turno_caja_id,
    clase_alumno_id, jugador_id,
    monto_clase, monto_consumo
  ) VALUES (
    v_club_id, v_alumno.clase_id, v_alumno.fecha, p_monto,
    p_medio_pago, p_observaciones, v_usuario_id,
    v_cuenta_id, v_turno_caja_id,
    p_clase_alumno_id, v_alumno.jugador_id,
    v_monto_clase, v_monto_consumo
  )
  RETURNING * INTO v_cobro;

  RETURN v_cobro;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cobrar_alumno_clase(BIGINT, VARCHAR, DECIMAL, DECIMAL, DECIMAL, TEXT, BIGINT) TO authenticated;


-- ============================================================================
-- 6. ACTUALIZACIÓN DE fn_cobrar_persona_turno (soporte consumos individuales)
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_cobrar_persona_turno(
  p_reserva_jugador_id BIGINT,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_monto_esperado NUMERIC,
  p_cuenta_id BIGINT DEFAULT NULL,
  p_monto NUMERIC DEFAULT NULL
)
RETURNS reserva_pagos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva reservas;
  v_persona reserva_jugadores;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cuenta_id BIGINT;
  v_turno_caja_id BIGINT := NULL;

  v_total_consumos_partido DECIMAL(12,2) := 0;
  v_total_consumos_general DECIMAL(12,2) := 0;
  v_total_consumos_individual DECIMAL(12,2) := 0;
  v_total_consumos DECIMAL(12,2) := 0;
  v_total_a_cobrar DECIMAL(12,2) := 0;
  v_total_cobrado DECIMAL(12,2) := 0;
  v_saldo_global_restante DECIMAL(12,2) := 0;
  v_alquiler_restante_global DECIMAL(12,2) := 0;

  v_cantidad_jugadores INT := 0;
  v_cantidad_personas INT := 0;
  v_cant_jug_sin_fija INT := 0;
  v_cant_pers_sin_fija INT := 0;
  v_alquiler_fijado DECIMAL(12,2) := 0;
  v_consumo_fijado DECIMAL(12,2) := 0;
  v_alquiler_restante DECIMAL(12,2) := 0;
  v_consumo_restante DECIMAL(12,2) := 0;

  v_parte_alquiler DECIMAL(12,2) := 0;
  v_parte_consumo_partido DECIMAL(12,2) := 0;
  v_parte_consumo_general DECIMAL(12,2) := 0;
  v_parte_consumo DECIMAL(12,2) := 0;

  v_ya_pagado_alquiler DECIMAL(12,2) := 0;
  v_ya_pagado_consumo DECIMAL(12,2) := 0;
  v_saldo_alquiler DECIMAL(12,2) := 0;
  v_saldo_consumo DECIMAL(12,2) := 0;
  v_monto_real DECIMAL(12,2) := 0;
  v_monto_cobrado DECIMAL(12,2) := 0;

  v_cobro_alquiler DECIMAL(12,2) := 0;
  v_cobro_consumo DECIMAL(12,2) := 0;

  v_pago reserva_pagos;
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  SELECT * INTO v_persona
  FROM reserva_jugadores
  WHERE id = p_reserva_jugador_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona indicada no pertenece a este turno.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_persona.reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar un turno cancelado.';
  END IF;

  -- Resolver cuenta destino
  IF p_cuenta_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'La cuenta indicada no pertenece al club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT cuenta_id INTO v_cuenta_id
    FROM medio_cuenta_default
    WHERE club_id = v_club_id AND medio_pago = p_medio_pago;
  END IF;

  -- Resolver caja si es efectivo
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
  END IF;

  -- Totales del turno a nivel global
  -- Individual: solo los consumos de ESTA persona
  SELECT
    COALESCE(SUM(subtotal) FILTER (WHERE reserva_jugador_id IS NULL AND tipo_reparto = 'partido'), 0),
    COALESCE(SUM(subtotal) FILTER (WHERE reserva_jugador_id IS NULL AND tipo_reparto = 'general'), 0),
    COALESCE(SUM(subtotal) FILTER (WHERE reserva_jugador_id = p_reserva_jugador_id), 0),
    COALESCE(SUM(subtotal), 0)
  INTO v_total_consumos_partido, v_total_consumos_general, v_total_consumos_individual, v_total_consumos
  FROM reserva_consumos
  WHERE reserva_id = v_persona.reserva_id;

  v_total_a_cobrar := v_reserva.monto_total + v_total_consumos;

  SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado
  FROM reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;

  v_saldo_global_restante := GREATEST(0, v_total_a_cobrar - v_total_cobrado);

  IF v_saldo_global_restante <= 0 THEN
    RAISE EXCEPTION 'El turno ya está 100%% pagado en su totalidad ($% pagados de $%). No queda saldo pendiente.',
      v_total_cobrado, v_total_a_cobrar;
  END IF;

  SELECT GREATEST(0, v_reserva.monto_total - COALESCE(SUM(monto_alquiler), 0))
  INTO v_alquiler_restante_global
  FROM reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;

  -- Cantidades y cuotas fijadas
  SELECT
    COUNT(*) FILTER (WHERE tipo = 'jugador'),
    COUNT(*),
    COUNT(*) FILTER (WHERE tipo = 'jugador' AND cuota_fija IS NULL),
    COUNT(*) FILTER (WHERE cuota_fija IS NULL),
    COALESCE(SUM(CASE WHEN tipo = 'jugador' AND cuota_fija IS NOT NULL THEN LEAST(cuota_fija, v_reserva.monto_total) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cuota_fija IS NOT NULL THEN GREATEST(0, cuota_fija - (CASE WHEN tipo = 'jugador' THEN LEAST(cuota_fija, v_reserva.monto_total) ELSE 0 END)) ELSE 0 END), 0)
  INTO
    v_cantidad_jugadores,
    v_cantidad_personas,
    v_cant_jug_sin_fija,
    v_cant_pers_sin_fija,
    v_alquiler_fijado,
    v_consumo_fijado
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id;

  v_alquiler_restante := GREATEST(0, v_reserva.monto_total - v_alquiler_fijado);

  IF v_persona.cuota_fija IS NOT NULL THEN
    IF v_persona.tipo = 'jugador' THEN
      v_parte_alquiler := LEAST(v_persona.cuota_fija, v_reserva.monto_total);
    ELSE
      v_parte_alquiler := 0;
    END IF;
    v_parte_consumo := GREATEST(0, v_persona.cuota_fija - v_parte_alquiler);
  ELSE
    IF v_persona.tipo = 'jugador' AND v_cant_jug_sin_fija > 0 AND v_alquiler_restante > 0 THEN
      v_parte_alquiler := ROUND(v_alquiler_restante / v_cant_jug_sin_fija, 2);
    ELSE
      v_parte_alquiler := 0;
    END IF;

    -- Consumos grupales
    v_parte_consumo_partido := CASE
      WHEN v_cantidad_jugadores > 0 AND v_total_consumos_partido > 0 AND v_persona.tipo = 'jugador'
      THEN ROUND(v_total_consumos_partido / v_cantidad_jugadores, 2)
      ELSE 0
    END;

    v_parte_consumo_general := CASE
      WHEN v_cantidad_personas > 0 AND v_total_consumos_general > 0
      THEN ROUND(v_total_consumos_general / v_cantidad_personas, 2)
      ELSE 0
    END;

    -- Parte de consumo = consumos individuales propios + parte proporcional de los grupales
    v_parte_consumo := v_total_consumos_individual + CASE
      WHEN v_persona.tipo = 'jugador'
      THEN v_parte_consumo_partido + v_parte_consumo_general
      ELSE v_parte_consumo_general
    END;
  END IF;

  -- Ya pagado por esta persona
  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(monto_consumo), 0)
  INTO v_ya_pagado_alquiler, v_ya_pagado_consumo
  FROM reserva_pagos
  WHERE reserva_jugador_id = p_reserva_jugador_id;

  v_saldo_alquiler := GREATEST(
    0,
    (CASE WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler ELSE 0 END) - v_ya_pagado_alquiler
  );
  v_saldo_consumo := GREATEST(0, v_parte_consumo - v_ya_pagado_consumo);

  v_monto_real := LEAST(v_saldo_alquiler + v_saldo_consumo, v_saldo_global_restante);

  -- Monto cobrado
  IF p_monto IS NOT NULL AND p_monto > 0 THEN
    v_monto_cobrado := LEAST(p_monto, v_saldo_global_restante);
  ELSE
    v_monto_cobrado := v_monto_real;
  END IF;

  IF v_monto_cobrado <= 0 THEN
    RAISE EXCEPTION 'Esta persona ya no tiene saldo pendiente por pagar.';
  END IF;

  -- Desglose seguro
  v_cobro_alquiler := LEAST(v_monto_cobrado, v_alquiler_restante_global);
  v_cobro_consumo  := v_monto_cobrado - v_cobro_alquiler;

  -- Insertar pago
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
    jugador_id, reserva_jugador_id, monto_alquiler, monto_consumo,
    cuenta_id, turno_caja_id
  ) VALUES (
    v_club_id, v_persona.reserva_id, v_monto_cobrado, p_medio_pago, 'pago',
    v_usuario_id, p_observaciones, v_persona.jugador_id, p_reserva_jugador_id,
    v_cobro_alquiler, v_cobro_consumo, v_cuenta_id, v_turno_caja_id
  )
  RETURNING * INTO v_pago;

  -- Auto-fijar cuota al saldar
  IF (v_ya_pagado_alquiler + v_ya_pagado_consumo + v_monto_cobrado) >= (v_parte_alquiler + v_parte_consumo) THEN
    UPDATE reserva_jugadores
    SET cuota_fija = COALESCE(cuota_fija, (v_ya_pagado_alquiler + v_ya_pagado_consumo + v_monto_cobrado))
    WHERE id = p_reserva_jugador_id;
  END IF;

  -- Actualizar estado de la reserva
  SELECT COALESCE(SUM(monto_alquiler), 0) INTO v_nuevo_monto_pagado
  FROM reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;

  v_nuevo_estado := CASE
    WHEN (v_total_cobrado + v_monto_cobrado) >= v_total_a_cobrar THEN 'pagada'
    WHEN (v_total_cobrado + v_monto_cobrado) > 0 THEN 'senada'
    ELSE v_reserva.estado
  END;

  UPDATE reservas
  SET
    monto_pagado = LEAST(v_nuevo_monto_pagado, monto_total),
    estado = v_nuevo_estado
  WHERE id = v_persona.reserva_id;

  RETURN v_pago;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cobrar_persona_turno(BIGINT, VARCHAR, TEXT, NUMERIC, BIGINT, NUMERIC) TO authenticated;

COMMIT;
