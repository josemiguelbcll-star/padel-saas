-- ============================================================================
-- 0028_finanzas_rpcs_y_caja.sql
-- Módulo Financiero — Bloque 2 (RPCs operativas + extensión del cierre
-- de caja).
--
-- =====================================================================
-- QUÉ HACE ESTA MIGRACIÓN
-- =====================================================================
-- 1. fn_registrar_gasto: alta de un gasto. Acepta pago opcional —
--    si fecha_pago + medio_pago vienen, el gasto queda pagado; si
--    no, queda pendiente (fecha_pago, medio_pago, turno_caja_id NULL).
--    Si medio_pago='efectivo' aplica regla de oro: valida caja
--    abierta y setea turno_caja_id.
--
-- 2. fn_registrar_otro_ingreso: análogo del lado ingreso. Acepta
--    cobro opcional. Misma regla de oro para efectivo.
--
-- 3. CREATE OR REPLACE fn_cerrar_caja: extiende el cálculo del
--    esperado server-side para incluir los DOS términos nuevos:
--      + otros_ingresos en efectivo de esta caja (suman al esperado)
--      − gastos en efectivo de esta caja          (restan al esperado)
--    Filtros: turno_caja_id = caja Y medio_pago='efectivo' Y activo=TRUE
--    (activo=TRUE para que cuando se implemente fn_anular_gasto en v2,
--    los anulados no se cuenten).
--    SIGNATURA IDÉNTICA — el frontend no se entera.
--
-- =====================================================================
-- IMPACTO OPERATIVO
-- =====================================================================
-- Sin impacto en cierres pre-0028: las cajas históricas no tenían
-- gastos ni otros_ingresos atados, así que las dos sumas nuevas dan 0
-- para ellas. Los cierres post-0028 que tengan gastos/ingresos en
-- efectivo van a reflejarlos correctamente en el esperado.
--
-- =====================================================================
-- REGLA DE ORO DEL EFECTIVO (idem cobros 0023)
-- =====================================================================
-- Si medio_pago='efectivo':
--   - fn_registrar_gasto valida caja abierta + setea turno_caja_id.
--   - fn_registrar_otro_ingreso ídem.
-- Si no hay caja abierta y se intenta pagar/cobrar en efectivo:
--   RAISE con mensaje uniforme:
--   'No hay caja abierta. Pedile a la administración que abra la
--    caja del día antes de cobrar/pagar en efectivo.'
-- ============================================================================

BEGIN;

-- ============================================================================
-- RPC 1/3: fn_registrar_gasto
--
-- Gate: admin O vendedor del club.
-- Resolución de unidad: deriva categoría → unidad (FK), copia
--   unidad_id + unidad_nombre + unidad_tipo + categoria_nombre como
--   SNAPSHOTS (patrón venta_items / reserva_consumos).
-- Pago opcional:
--   - p_fecha_pago + p_medio_pago vienen ambos → gasto pagado.
--   - p_fecha_pago + p_medio_pago vienen ambos NULL → gasto pendiente.
--   - Solo uno de los dos → RAISE (incoherencia: o pagás o no pagás).
-- Efectivo:
--   - p_medio_pago='efectivo' → llamar current_club_caja_abierta(),
--     validar caja existe, setear turno_caja_id. Si no hay, RAISE.
--   - Otro medio → turno_caja_id queda NULL.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_registrar_gasto(
  p_categoria_id BIGINT,
  p_monto DECIMAL,
  p_fecha_gasto DATE,
  p_proveedor VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL
)
RETURNS gastos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_categoria categorias_gasto;
  v_unidad unidades_negocio;
  v_turno_caja_id BIGINT := NULL;
  v_gasto gastos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para registrar gastos.';
  END IF;

  -- Validaciones de input.
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del gasto debe ser mayor a 0.';
  END IF;

  IF p_fecha_gasto IS NULL THEN
    RAISE EXCEPTION 'La fecha del gasto es obligatoria.';
  END IF;

  -- Pago atómico: o ambos vienen, o ninguno.
  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si pagás el gasto, tenés que indicar fecha de pago Y medio de pago. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;

  -- Validar medio_pago si viene.
  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- Resolver categoría → unidad (con check de club).
  SELECT * INTO v_categoria
  FROM categorias_gasto
  WHERE id = p_categoria_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_categoria.activa THEN
    RAISE EXCEPTION
      'La categoría "%" está desactivada — no se pueden cargar gastos sobre ella. Pedile al admin que la reactive o elegí otra.',
      v_categoria.nombre;
  END IF;

  SELECT * INTO v_unidad
  FROM unidades_negocio
  WHERE id = v_categoria.unidad_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    -- No debería pasar (FK garantiza unidad_id válido), pero defense in depth.
    RAISE EXCEPTION 'La unidad de negocio asociada a la categoría no existe.';
  END IF;

  -- REGLA DE ORO DEL EFECTIVO: si pago en efectivo, atar a la caja
  -- abierta. Falla rápido antes del INSERT.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar/pagar en efectivo.';
    END IF;
  END IF;

  -- INSERT con snapshots de categoría y unidad.
  INSERT INTO gastos (
    club_id,
    categoria_id, categoria_nombre,
    unidad_id, unidad_nombre, unidad_tipo,
    monto, fecha_gasto,
    fecha_pago, medio_pago, turno_caja_id,
    proveedor, observaciones,
    usuario_id
  ) VALUES (
    v_club_id,
    v_categoria.id, v_categoria.nombre,
    v_unidad.id, v_unidad.nombre, v_unidad.tipo,
    p_monto, p_fecha_gasto,
    p_fecha_pago, p_medio_pago, v_turno_caja_id,
    p_proveedor, p_observaciones,
    v_usuario_id
  )
  RETURNING * INTO v_gasto;

  RETURN v_gasto;
END;
$$;

COMMENT ON FUNCTION fn_registrar_gasto(BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR) IS
  'Registra un gasto con snapshots de categoría/unidad. Acepta pago
   opcional (fecha_pago + medio_pago juntos o nada = pendiente). Si
   medio_pago=efectivo, aplica regla de oro: requiere caja abierta y
   setea turno_caja_id atómicamente. Gate: admin O vendedor del club.';

GRANT EXECUTE ON FUNCTION fn_registrar_gasto(BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR)
  TO authenticated;


-- ============================================================================
-- RPC 2/3: fn_registrar_otro_ingreso
--
-- Análogo a fn_registrar_gasto pero del lado ingreso. La unidad
-- viene directa (no hay categoría intermedia en otros_ingresos).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_registrar_otro_ingreso(
  p_unidad_id BIGINT,
  p_concepto VARCHAR,
  p_monto DECIMAL,
  p_fecha DATE,
  p_fecha_cobro DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS otros_ingresos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_unidad unidades_negocio;
  v_turno_caja_id BIGINT := NULL;
  v_concepto_trim VARCHAR;
  v_ingreso otros_ingresos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para registrar ingresos.';
  END IF;

  -- Validaciones.
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

  -- Cobro atómico: o ambos vienen, o ninguno.
  IF (p_fecha_cobro IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si cobraste el ingreso, tenés que indicar fecha de cobro Y medio de pago. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- Resolver unidad (con check de club).
  SELECT * INTO v_unidad
  FROM unidades_negocio
  WHERE id = p_unidad_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad de negocio no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_unidad.activa THEN
    RAISE EXCEPTION
      'La unidad "%" está desactivada — no se pueden cargar ingresos sobre ella. Pedile al admin que la reactive o elegí otra.',
      v_unidad.nombre;
  END IF;

  -- REGLA DE ORO DEL EFECTIVO: si cobro en efectivo, atar a la caja
  -- abierta. Falla rápido antes del INSERT.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar/pagar en efectivo.';
    END IF;
  END IF;

  -- INSERT con snapshots de unidad.
  INSERT INTO otros_ingresos (
    club_id,
    unidad_id, unidad_nombre, unidad_tipo,
    concepto, monto, fecha,
    fecha_cobro, medio_pago, turno_caja_id,
    observaciones,
    usuario_id
  ) VALUES (
    v_club_id,
    v_unidad.id, v_unidad.nombre, v_unidad.tipo,
    v_concepto_trim, p_monto, p_fecha,
    p_fecha_cobro, p_medio_pago, v_turno_caja_id,
    p_observaciones,
    v_usuario_id
  )
  RETURNING * INTO v_ingreso;

  RETURN v_ingreso;
END;
$$;

COMMENT ON FUNCTION fn_registrar_otro_ingreso(BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT) IS
  'Registra un otro_ingreso (auspicios/membresías/etc.) con snapshot
   de unidad. Acepta cobro opcional. Misma regla de oro del efectivo
   que fn_registrar_gasto y los cobros operativos.';

GRANT EXECUTE ON FUNCTION fn_registrar_otro_ingreso(BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT)
  TO authenticated;


-- ============================================================================
-- RPC 3/3: fn_cerrar_caja (CREATE OR REPLACE — versión vigente en 0022)
--
-- Cambios respecto de 0022:
--   ⭐ NUEVO: 2 términos en el cálculo del esperado:
--      + Σ otros_ingresos en efectivo de esta caja (suman)
--      − Σ gastos en efectivo de esta caja          (restan)
--      Filtrados por turno_caja_id Y medio_pago='efectivo' Y activo=TRUE.
--
-- Resto IDÉNTICO al de 0022 (gate de rol, validación de contado,
-- lock FOR UPDATE, cálculo de cobros efectivo con reembolsos,
-- movimientos manuales, UPDATE con diferencia, RETURN).
--
-- SIGNATURA IDÉNTICA → cero cambio para el frontend.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cerrar_caja(
  p_turno_caja_id BIGINT,
  p_efectivo_contado DECIMAL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS turnos_caja
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_turno turnos_caja;
  v_entradas_cobros DECIMAL(12,2);
  v_movimientos_neto DECIMAL(12,2);
  v_otros_ingresos_efectivo DECIMAL(12,2);  -- ⭐ NUEVO 0028
  v_gastos_efectivo DECIMAL(12,2);          -- ⭐ NUEVO 0028
  v_esperado DECIMAL(12,2);
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cerrar la caja.';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio y no puede ser negativo.';
  END IF;

  -- Lock para evitar cierres concurrentes (sin cambios).
  SELECT * INTO v_turno
  FROM turnos_caja
  WHERE id = p_turno_caja_id AND club_id = current_club_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada.';
  END IF;
  IF v_turno.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta caja ya está cerrada.';
  END IF;

  -- ── Entradas de cobros en efectivo (regla de oro) ────────────────
  -- IDÉNTICO a 0022. Filtramos por turno_caja_id Y medio_pago='efectivo'
  -- (doble defensa). reserva_pagos.tipo='reembolso' resta (devolvimos
  -- efectivo).
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'reembolso' THEN -monto ELSE monto END
  ), 0)
  INTO v_entradas_cobros
  FROM (
    SELECT monto, tipo
      FROM reserva_pagos
      WHERE turno_caja_id = p_turno_caja_id
        AND medio_pago = 'efectivo'
    UNION ALL
    SELECT monto_total AS monto, 'pago' AS tipo
      FROM ventas
      WHERE turno_caja_id = p_turno_caja_id
        AND medio_pago = 'efectivo'
    UNION ALL
    SELECT monto, 'pago' AS tipo
      FROM clase_cobros
      WHERE turno_caja_id = p_turno_caja_id
        AND medio_pago = 'efectivo'
  ) entradas;

  -- ── Movimientos manuales (neto) ──────────────────────────────────
  -- IDÉNTICO a 0022. ajuste_positivo suma; el resto (retiro,
  -- pago_proveedor, ajuste_negativo) resta.
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'ajuste_positivo' THEN monto ELSE -monto END
  ), 0)
  INTO v_movimientos_neto
  FROM caja_movimientos_manuales
  WHERE turno_caja_id = p_turno_caja_id;

  -- ⭐ NUEVO 0028 — Otros ingresos en efectivo de esta caja (SUMAN).
  -- Filtro triple: caja específica + efectivo + activo (para que
  -- cuando se implemente soft-delete con activo=FALSE en v2, los
  -- ingresos anulados no se cuenten).
  SELECT COALESCE(SUM(monto), 0)
  INTO v_otros_ingresos_efectivo
  FROM otros_ingresos
  WHERE turno_caja_id = p_turno_caja_id
    AND medio_pago = 'efectivo'
    AND activo = TRUE;

  -- ⭐ NUEVO 0028 — Gastos en efectivo de esta caja (RESTAN).
  -- Mismo filtro triple.
  SELECT COALESCE(SUM(monto), 0)
  INTO v_gastos_efectivo
  FROM gastos
  WHERE turno_caja_id = p_turno_caja_id
    AND medio_pago = 'efectivo'
    AND activo = TRUE;

  -- ⭐ ESPERADO ampliado: apertura + cobros + movimientos neto
  --    + otros_ingresos efectivo (suma) − gastos efectivo (resta).
  v_esperado := v_turno.monto_apertura
              + v_entradas_cobros
              + v_movimientos_neto
              + v_otros_ingresos_efectivo
              - v_gastos_efectivo;

  UPDATE turnos_caja
  SET cerrada_en = NOW(),
      usuario_cierre = auth.uid(),
      efectivo_esperado = v_esperado,
      efectivo_contado = p_efectivo_contado,
      diferencia = p_efectivo_contado - v_esperado,
      observaciones_cierre = p_observaciones
  WHERE id = p_turno_caja_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION fn_cerrar_caja(BIGINT, DECIMAL, TEXT) IS
  'Cierra una caja abierta con arqueo. Calcula esperado server-side:
   apertura + cobros efectivo (con reembolsos restando) + movimientos
   manuales netos + otros_ingresos efectivo (0028) − gastos efectivo
   (0028). Guarda diferencia = contado − esperado. Gate: admin O
   vendedor. Lock FOR UPDATE para concurrencia.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0028_finanzas_rpcs_y_caja.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Pre-requisito: tener caja abierta para los tests de efectivo. Si no:
--   SELECT fn_abrir_caja(0);

-- ---------- A. Las 3 RPCs con signatura correcta ----------
-- SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS ret
-- FROM pg_proc
-- WHERE proname IN ('fn_registrar_gasto','fn_registrar_otro_ingreso','fn_cerrar_caja');
-- → fn_cerrar_caja sin cambios respecto a 0022.

-- ---------- B. Gasto NO efectivo SIN caja → funciona ----------
-- await window.supabase.rpc('fn_registrar_gasto', {
--   p_categoria_id: <id de "Alquiler local">,
--   p_monto: 100000,
--   p_fecha_gasto: '2026-05-01',
--   p_fecha_pago: '2026-05-21',
--   p_medio_pago: 'transferencia',
--   p_proveedor: 'Inmobiliaria X'
-- });
-- → OK, fila en gastos con turno_caja_id=NULL.

-- ---------- C. Gasto EFECTIVO con caja abierta → se ata ----------
-- await window.supabase.rpc('fn_registrar_gasto', {
--   p_categoria_id: <id de "Mercadería">,
--   p_monto: 1500,
--   p_fecha_gasto: '2026-05-21',
--   p_fecha_pago: '2026-05-21',
--   p_medio_pago: 'efectivo',
--   p_proveedor: 'Coca'
-- });
-- → OK. Verificar: SELECT id, monto, turno_caja_id FROM gastos ORDER BY id DESC LIMIT 1;
--   turno_caja_id debe ser el id de la caja abierta.

-- ---------- D. Gasto EFECTIVO sin caja → RECHAZA ----------
-- Cerrá la caja primero. Después:
--   await window.supabase.rpc('fn_registrar_gasto', {
--     p_categoria_id: <id>, p_monto: 100, p_fecha_gasto: '2026-05-21',
--     p_fecha_pago: '2026-05-21', p_medio_pago: 'efectivo'
--   });
-- → 'No hay caja abierta. Pedile a la administración...'

-- ---------- E. Gasto PENDIENTE (sin pago) → funciona ----------
-- await window.supabase.rpc('fn_registrar_gasto', {
--   p_categoria_id: <id>, p_monto: 50000, p_fecha_gasto: '2026-06-01'
-- });
-- → OK. Verificar fecha_pago, medio_pago, turno_caja_id todos NULL.

-- ---------- F. Pago atómico — solo uno de los dos → RECHAZA ----------
-- await window.supabase.rpc('fn_registrar_gasto', {
--   p_categoria_id: <id>, p_monto: 100, p_fecha_gasto: '2026-05-21',
--   p_fecha_pago: '2026-05-21'  -- sin medio_pago
-- });
-- → 'Si pagás el gasto, tenés que indicar fecha de pago Y medio de pago...'

-- ---------- G. Otro_ingreso en efectivo con caja → se ata ----------
-- Abrí caja primero. Después:
--   await window.supabase.rpc('fn_registrar_otro_ingreso', {
--     p_unidad_id: <id de "Estructura" o crear "Auspicios" antes>,
--     p_concepto: 'Auspicio camiseta',
--     p_monto: 50000,
--     p_fecha: '2026-05-01',
--     p_fecha_cobro: '2026-05-21',
--     p_medio_pago: 'efectivo'
--   });
-- → OK. Verificar turno_caja_id seteado.

-- ---------- H. Cierre de caja CON gasto y otro_ingreso ----------
-- Estado: apertura=5000, gasto efectivo=1500 (test C), otro_ingreso efectivo=50000 (test G).
-- Esperado = 5000 + 0 cobros + 0 movimientos + 50000 ingreso - 1500 gasto = 53500.
--   await window.supabase.rpc('fn_cerrar_caja', {
--     p_turno_caja_id: <id>, p_efectivo_contado: 53500
--   });
-- → diferencia = 0 (cuadra).

-- ---------- I. Gate por rol ----------
-- Como vendedor:
--   await window.supabase.rpc('fn_registrar_gasto', {...});
-- → OK (admin O vendedor).
--
-- Como anon (logout):
--   await supabase.rpc('fn_registrar_gasto', {...});
-- → 'No hay sesión activa.'
-- ============================================================================
