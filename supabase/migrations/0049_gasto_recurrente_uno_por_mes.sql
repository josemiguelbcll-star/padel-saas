-- ============================================================================
-- 0049_gasto_recurrente_uno_por_mes.sql
-- PARTE 4 del sistema de anulación (Caso 3): un gasto real por plantilla
-- recurrente por mes. Si ya se cargó el real de una plantilla este mes, la
-- tarjeta ofrece "Corregir" (anular + recargar, 0048) en vez de "Cargar otro".
--
-- =====================================================================
-- QUÉ HACE
-- =====================================================================
-- 1. Índice único parcial uq_gasto_recurrente_mes: GARANTÍA DURA de que
--    no haya dos gastos ACTIVOS de la misma plantilla en el mismo mes
--    (por mes calendario de fecha_gasto). El filtro activo=TRUE permite
--    RECARGAR tras anular en el mismo mes (el anulado deja de contar).
--
-- 2. fn_registrar_gasto v5 (DROP+CREATE): suma el CHECK uno-por-mes
--    cuando viene p_gasto_recurrente_id (mensaje amable), y captura el
--    unique_violation del índice (race concurrente) devolviendo el mismo
--    mensaje. Todo lo demás IDÉNTICO a v4 (0046).
--
-- La firma NO cambia (el check reusa p_gasto_recurrente_id). Uso DROP+CREATE
-- por consistencia con el historial de la función; re-aplico el GRANT.
--
-- =====================================================================
-- ⚠️ PRE-CONDICIÓN (correr ANTES de aplicar)
-- =====================================================================
-- El CREATE UNIQUE INDEX falla si YA existen dos gastos activos de la
-- misma plantilla en el mismo mes (data previa al guard). Detectarlos:
--
--   SELECT gasto_recurrente_id, date_trunc('month', fecha_gasto) AS mes,
--          COUNT(*), array_agg(id)
--   FROM gastos
--   WHERE activo = TRUE AND gasto_recurrente_id IS NOT NULL
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
-- Si devuelve filas, anulá los duplicados (fn_anular_gasto) antes de
-- aplicar esta migración.
--
-- =====================================================================
-- HISTORIAL DE fn_registrar_gasto (NO perder nada)
-- =====================================================================
--   0027: versión base (gate, validaciones, snapshots categoría/unidad,
--         pago opcional, regla de oro del efectivo).
--   0039: + p_proveedor_id (resolución de proveedor, snapshot del nombre).
--   0045: + p_fecha_vencimiento + p_skip_cuota_automatica (cuota
--         automática si nace pendiente y no skip).
--   0046: + p_gasto_recurrente_id (valida plantilla existe + categoría
--         coincide; INSERT con el FK a la plantilla).
--   0049: + CHECK uno-por-mes para recurrentes + captura unique_violation.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Índice único parcial — garantía dura del uno-por-mes
-- ============================================================================
-- Único por (plantilla, mes calendario de fecha_gasto), solo entre los
-- gastos ACTIVOS y vinculados a una plantilla. date_trunc('month',
-- fecha_gasto::timestamp) es IMMUTABLE → válido en índice de expresión.
-- El WHERE activo=TRUE hace que un gasto anulado libere el "cupo" del mes
-- (se puede recargar tras anular). El WHERE gasto_recurrente_id IS NOT
-- NULL deja fuera a los gastos manuales (que no tienen tope por mes).
CREATE UNIQUE INDEX uq_gasto_recurrente_mes
  ON gastos (gasto_recurrente_id, (date_trunc('month', fecha_gasto::timestamp)))
  WHERE activo = TRUE AND gasto_recurrente_id IS NOT NULL;

COMMENT ON INDEX uq_gasto_recurrente_mes IS
  'Garantía dura: un solo gasto ACTIVO por plantilla recurrente por mes
   calendario (fecha_gasto). El filtro activo=TRUE permite recargar tras
   anular en el mismo mes. fn_registrar_gasto captura el unique_violation
   con mensaje amable.';


-- ============================================================================
-- 2. fn_registrar_gasto v5 — DROP + CREATE
-- ============================================================================
-- Firma sin cambios (11 params, idéntica a v4/0046). DROP de la 11-param.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN, BIGINT
);

CREATE OR REPLACE FUNCTION fn_registrar_gasto(
  p_categoria_id BIGINT,
  p_monto DECIMAL,
  p_fecha_gasto DATE,
  p_proveedor VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_proveedor_id BIGINT DEFAULT NULL,
  p_fecha_vencimiento DATE DEFAULT NULL,
  p_skip_cuota_automatica BOOLEAN DEFAULT FALSE,
  p_gasto_recurrente_id BIGINT DEFAULT NULL
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
  v_proveedor proveedores;
  v_proveedor_snapshot VARCHAR(120) := p_proveedor;
  v_recurrente gastos_recurrentes;
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

  -- Resolver proveedor si viene proveedor_id. El snapshot del nombre
  -- gana sobre p_proveedor (texto suelto) cuando proveedor_id está
  -- presente — más confiable que texto que el admin pudo tipear mal.
  IF p_proveedor_id IS NOT NULL THEN
    SELECT * INTO v_proveedor
    FROM proveedores
    WHERE id = p_proveedor_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
    END IF;
    IF NOT v_proveedor.activo THEN
      RAISE EXCEPTION
        'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de cargar el gasto.',
        v_proveedor.nombre;
    END IF;

    v_proveedor_snapshot := v_proveedor.nombre;
  END IF;

  -- 0046: si viene p_gasto_recurrente_id, validar la plantilla y exigir
  -- que su categoría coincida con p_categoria_id (defensa: el frontend
  -- pre-llena, pero un usuario podría cambiar la categoría en el dialog y
  -- romper la coherencia "este gasto pertenece a esta plantilla"). NO
  -- chequeamos activo=TRUE — permitimos cargar un real atrasado de una
  -- plantilla recién desactivada.
  IF p_gasto_recurrente_id IS NOT NULL THEN
    SELECT * INTO v_recurrente
    FROM gastos_recurrentes
    WHERE id = p_gasto_recurrente_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La plantilla recurrente no existe o no pertenece a tu club.';
    END IF;

    IF v_recurrente.categoria_id <> p_categoria_id THEN
      RAISE EXCEPTION
        'La categoría del gasto no coincide con la categoría de la plantilla "%". Si querés cambiar la categoría, editá la plantilla primero.',
        v_recurrente.concepto;
    END IF;

    -- ⭐ NUEVO 0049: CHECK uno-por-mes. Rechazar si ya hay OTRO gasto
    -- ACTIVO de esta plantilla en el mismo mes calendario de p_fecha_gasto.
    -- activo=TRUE: un real anulado NO bloquea (permite recargar tras
    -- anular). Mensaje amable que empuja a "Corregir" en vez de duplicar.
    IF EXISTS (
      SELECT 1 FROM gastos
      WHERE gasto_recurrente_id = p_gasto_recurrente_id
        AND club_id = v_club_id
        AND activo = TRUE
        AND date_trunc('month', fecha_gasto::timestamp)
            = date_trunc('month', p_fecha_gasto::timestamp)
    ) THEN
      RAISE EXCEPTION
        'Ya cargaste un gasto de "%" para %. Si el monto está mal, corregilo desde la tarjeta de recurrentes (no cargues otro).',
        v_recurrente.concepto, to_char(p_fecha_gasto, 'MM/YYYY');
    END IF;
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

  -- INSERT con snapshots de categoría, unidad y proveedor + el FK a la
  -- plantilla recurrente (si vino).
  --
  -- ⭐ NUEVO 0049: el INSERT puede disparar uq_gasto_recurrente_mes
  -- (garantía dura). Eso solo ocurre con p_gasto_recurrente_id NOT NULL +
  -- dup en el mes — típicamente una RACE con otro INSERT concurrente que
  -- también pasó el EXISTS de arriba (es el único índice UNIQUE de
  -- gastos). Capturamos y devolvemos el MISMO mensaje amable.
  BEGIN
    INSERT INTO gastos (
      club_id,
      categoria_id, categoria_nombre,
      unidad_id, unidad_nombre, unidad_tipo,
      monto, fecha_gasto,
      fecha_pago, medio_pago, turno_caja_id,
      proveedor, proveedor_id,
      observaciones,
      gasto_recurrente_id,
      usuario_id
    ) VALUES (
      v_club_id,
      v_categoria.id, v_categoria.nombre,
      v_unidad.id, v_unidad.nombre, v_unidad.tipo,
      p_monto, p_fecha_gasto,
      p_fecha_pago, p_medio_pago, v_turno_caja_id,
      v_proveedor_snapshot, p_proveedor_id,
      p_observaciones,
      p_gasto_recurrente_id,
      v_usuario_id
    )
    RETURNING * INTO v_gasto;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'Ya cargaste un gasto de "%" para %. Si el monto está mal, corregilo desde la tarjeta de recurrentes (no cargues otro).',
        v_recurrente.concepto, to_char(p_fecha_gasto, 'MM/YYYY');
  END;

  -- 0045: si el gasto nace PENDIENTE y el caller no pidió skip, generar
  -- una cuota total por defecto. Modelo uniforme para CxP: todo gasto
  -- pendiente tiene su deuda en gasto_cuotas.
  --
  -- p_skip_cuota_automatica=TRUE lo usa fn_recibir_oc cuando va a generar
  -- su propio plan (anticipo + N cuotas) — para no duplicar la cuota.
  --
  -- El p_gasto_recurrente_id NO afecta esta lógica: un gasto recurrente
  -- real pendiente genera su cuota igual que un gasto manual pendiente, y
  -- la cuota aparece en CxP automáticamente.
  IF v_gasto.fecha_pago IS NULL AND NOT p_skip_cuota_automatica THEN
    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id
    ) VALUES (
      v_club_id, v_gasto.id, 1, FALSE, v_gasto.monto,
      p_fecha_vencimiento, NULL, NULL, NULL,
      v_usuario_id
    );
  END IF;

  RETURN v_gasto;
END;
$$;

COMMENT ON FUNCTION fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN, BIGINT
) IS
  'Registra un gasto con snapshots de categoría/unidad/proveedor.
   0045: si nace pendiente y p_skip_cuota_automatica=FALSE, genera 1
   cuota total en gasto_cuotas (modelo uniforme para CxP).
   0046: si viene p_gasto_recurrente_id, vincula el gasto a una plantilla
   (valida que exista en el club y que su categoría coincida).
   0049: si viene p_gasto_recurrente_id, rechaza si ya hay otro gasto
   ACTIVO de esa plantilla en el mismo mes (CHECK + índice único parcial
   uq_gasto_recurrente_mes, con captura del unique_violation). NO afecta
   el EERR (el vínculo es metadata del panel). Gate: admin O vendedor.';

GRANT EXECUTE ON FUNCTION fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN, BIGINT
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0049_gasto_recurrente_uno_por_mes.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Índice creado ----------
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'gastos' AND indexname = 'uq_gasto_recurrente_mes';
-- → UNIQUE, sobre (gasto_recurrente_id, date_trunc('month', fecha_gasto::timestamp)),
--   WHERE (activo AND gasto_recurrente_id IS NOT NULL).

-- ---------- B. Firma intacta (11 params) ----------
-- SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'fn_registrar_gasto';
-- → 11 params, idéntica a v4 (termina en p_gasto_recurrente_id BIGINT DEFAULT NULL).

-- ---------- C. Primer real del mes desde una plantilla → OK ----------
-- await window.supabase.rpc('fn_registrar_gasto', {
--   p_categoria_id: <cat de la plantilla>, p_monto: 100000,
--   p_fecha_gasto: '2026-05-10', p_gasto_recurrente_id: <plantilla "Luz">
-- });
-- → gasto creado + 1 cuota (nace pendiente). En la tarjeta: "cargado este mes".

-- ---------- D. Segundo real del MISMO mes → rechazo amable ----------
-- await window.supabase.rpc('fn_registrar_gasto', {
--   p_categoria_id: <misma cat>, p_monto: 105000,
--   p_fecha_gasto: '2026-05-20', p_gasto_recurrente_id: <misma plantilla>
-- });
-- → 'Ya cargaste un gasto de "Luz" para 05/2026. Si el monto está mal,
--    corregilo desde la tarjeta de recurrentes (no cargues otro).'

-- ---------- E. Recargar tras ANULAR en el mismo mes → OK ----------
-- Anular el real del paso C (fn_anular_gasto), luego recargar mayo:
-- → OK (el anulado tiene activo=FALSE → no cuenta en el índice ni en el
--   EXISTS). Esto es el flujo "Corregir" (anular + recargar) del Caso 1.

-- ---------- F. Otra plantilla, mismo mes → OK ----------
-- Cargar "Agua" en mayo cuando ya está "Luz" de mayo → OK (distinta plantilla).

-- ---------- G. Mismo plantilla, OTRO mes → OK ----------
-- Cargar "Luz" de junio cuando ya está "Luz" de mayo → OK (distinto mes).

-- ---------- H. Gasto manual (sin plantilla) sin tope ----------
-- Varios gastos manuales (p_gasto_recurrente_id NULL) en el mismo mes → todos OK
-- (el índice y el check solo aplican a gasto_recurrente_id NOT NULL).

-- ---------- I. Regresión: lo de versiones anteriores sigue ----------
-- - Gasto pendiente manual → genera cuota (0045).
-- - Gasto pagado al instante en efectivo sin caja → rechazo regla de oro.
-- - fn_recibir_oc (que llama a fn_registrar_gasto con skip) → sigue OK,
--   sin cuota duplicada (p_gasto_recurrente_id NULL ahí → no toca el check).
-- - Categoría que no coincide con la plantilla → rechazo (0046).
-- ============================================================================
