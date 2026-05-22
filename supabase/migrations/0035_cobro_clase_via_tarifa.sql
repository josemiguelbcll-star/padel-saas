-- ============================================================================
-- 0035_cobro_clase_via_tarifa.sql
-- Modelo B: el alquiler de cancha de una clase se resuelve SIEMPRE via
-- fn_resolver_tarifa_clase(fecha, hora_inicio). Coherencia con turnos
-- fijos (que materializan con la tarifa resuelta por fecha).
--
-- =====================================================================
-- CAMBIOS
-- =====================================================================
-- 1. ALTER TABLE clases: clases.precio recibe DEFAULT 0 para que el
--    frontend pueda omitir el campo en INSERTs/UPDATEs.
--    La columna se MANTIENE (NOT NULL + CHECK >= 0) — queda como deuda
--    para eliminar en una limpieza futura cuando confirmemos cero usos.
--
-- 2. DROP fn_cobrar_clase(firma vieja con p_monto) +
--    CREATE fn_cobrar_clase(firma nueva sin p_monto).
--    El monto se RESUELVE INTERNAMENTE con fn_resolver_tarifa_clase
--    (snapshot al INSERT en clase_cobros.monto). Si no hay tarifa para
--    el slot, RAISE con mensaje accionable.
--
-- =====================================================================
-- VALIDACIONES PRESERVADAS (todas las de 0023)
-- =====================================================================
--   - Sesión activa (current_club_id + auth.uid).
--   - Medio de pago obligatorio.
--   - Si efectivo: caja abierta requerida (regla de oro del efectivo).
--   - SELECT FOR UPDATE de la clase (race-safe contra DELETE concurrente).
--   - Weekday: la fecha debe caer en clases.dias_semana.
--
-- =====================================================================
-- VALIDACIÓN NUEVA
-- =====================================================================
--   - Si fn_resolver_tarifa_clase(fecha, hora_clase) no devuelve fila,
--     RAISE 'No hay tarifa de clase configurada para los {día} a las
--     {hora}. Configurala en Configuración → Tarifas (pestaña Clases)
--     antes de cobrar.'
--
-- =====================================================================
-- VALIDACIÓN ELIMINADA
-- =====================================================================
--   - p_monto > 0 — ya no aplica (no recibimos p_monto). El CHECK
--     clase_cobros.monto > 0 server-side sigue protegiendo contra una
--     tarifa = 0 (que no debería pasar — fn_crear_tarifa_clase rechaza
--     monto <= 0).
--
-- =====================================================================
-- IMPACTO EN POSTGREST
-- =====================================================================
-- Cambio de signatura → PostgREST refresca su schema cache en ~30s.
-- Durante esa ventana, llamadas a la firma vieja pueden fallar. El
-- frontend del Bloque 1b se redeploya con la firma nueva, así que el
-- riesgo es bajo en producción.
--
-- =====================================================================
-- SNAPSHOT
-- =====================================================================
-- clase_cobros.monto sigue siendo NOT NULL CHECK > 0 (0007). El INSERT
-- inserta el monto RESUELTO al momento del cobro — la fila no se mueve
-- si después cambia la tarifa. Comportamiento idéntico a 0023, solo
-- cambia de dónde sale el valor.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ALTER TABLE clases — precio con DEFAULT 0
-- ============================================================================
--    El frontend deja de enviar `precio` en INSERTs/UPDATEs (Bloque 1c).
--    El default 0 cumple el CHECK existente (precio >= 0). Las filas
--    existentes mantienen su valor histórico — esta migración NO toca
--    datos, solo el default.
-- ============================================================================
ALTER TABLE clases ALTER COLUMN precio SET DEFAULT 0;

COMMENT ON COLUMN clases.precio IS
  'DEPRECATED (0035). El alquiler de cancha de la clase se resuelve via
   fn_resolver_tarifa_clase(fecha, hora_inicio). Esta columna queda con
   DEFAULT 0 y NOT NULL para no romper INSERTs viejos, pero ya no es
   fuente de verdad. Pendiente: eliminar en una migración de limpieza
   cuando se confirme cero usos en frontend y reportes.';


-- ============================================================================
-- 2. DROP fn_cobrar_clase (firma vieja con p_monto)
-- ============================================================================
--    Firma vieja exacta (vigente desde 0023):
--      (p_clase_id BIGINT, p_fecha DATE, p_monto DECIMAL,
--       p_medio_pago VARCHAR, p_observaciones TEXT) RETURNS clase_cobros
--
--    Especificamos tipos exactos: PostgreSQL puede tener overloads de
--    la misma función con firmas distintas; el DROP por firma específica
--    afecta SOLO la versión vieja con p_monto.
--
--    Verificado: solo existe una fn_cobrar_clase en la base (CREATE OR
--    REPLACE en 0007/0008/0023 pisaron sucesivamente la misma firma).
-- ============================================================================
DROP FUNCTION fn_cobrar_clase(BIGINT, DATE, DECIMAL, VARCHAR, TEXT);


-- ============================================================================
-- 3. CREATE fn_cobrar_clase — firma nueva, sin p_monto
-- ============================================================================
--    Cambio respecto a 0023:
--      - Saca p_monto del parámetro list (4 params en vez de 5).
--      - Saca la validación 'p_monto debe ser mayor a 0' (no aplica).
--      - SUMA: resuelve la tarifa con fn_resolver_tarifa_clase y RAISE
--        si no hay tarifa para el slot.
--      - Mantiene IDÉNTICAS todas las demás validaciones:
--          * Sesión activa.
--          * Medio de pago obligatorio.
--          * Caja abierta si efectivo (regla de oro).
--          * SELECT FOR UPDATE de la clase + validación de pertenencia.
--          * Weekday (ISODOW en clases.dias_semana).
--          * INSERT con turno_caja_id (0023).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cobrar_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_medio_pago VARCHAR,
  p_observaciones TEXT
)
RETURNS clase_cobros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clase clases;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cobro clase_cobros;
  v_turno_caja_id BIGINT := NULL;
  v_tarifa_resuelta RECORD;
  v_monto DECIMAL(12,2);
  v_dia_nombre TEXT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  -- ── Validación: sesión activa (PRESERVADA, idéntica a 0023). ──────
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- ── Validación: medio de pago obligatorio (PRESERVADA). ───────────
  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- ── Validación: caja abierta si efectivo (PRESERVADA, 0023). ──────
  --    Regla de oro del efectivo: si se cobra en efectivo, debe haber
  --    una caja abierta del club al momento; snapshoteamos turno_caja_id
  --    para trazabilidad del arqueo.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  -- ── Lock + validación de clase (PRESERVADA). ──────────────────────
  --    SELECT FOR UPDATE serializa el acceso a la fila de la clase para
  --    proteger contra DELETE concurrente (ver 0008). La verificación de
  --    pertenencia al club es la barrera multi-tenant a este nivel
  --    (además de la RLS).
  SELECT * INTO v_clase
  FROM clases
  WHERE id = p_clase_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece a tu club.';
  END IF;

  -- ── Validación: weekday (PRESERVADA). ─────────────────────────────
  --    La fecha puntual debe caer en uno de los días configurados en
  --    clases.dias_semana. EXTRACT(ISODOW) = 1 (lunes) ... 7 (domingo).
  IF NOT (EXTRACT(ISODOW FROM p_fecha)::INT = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION
      'La clase no se dicta el % — revisá los días configurados.', p_fecha;
  END IF;

  -- ──────────────────────────────────────────────────────────────────
  -- NUEVO 0035 — Resolver tarifa de clase para (fecha, hora_clase).
  -- Si no hay tarifa que cubra el slot, RAISE con mensaje accionable.
  -- El monto resuelto se inserta en clase_cobros.monto como SNAPSHOT
  -- (la fila ya no se mueve si después cambia la tarifa).
  -- ──────────────────────────────────────────────────────────────────
  SELECT tarifa_id, monto INTO v_tarifa_resuelta
  FROM fn_resolver_tarifa_clase(p_fecha, v_clase.hora_inicio);

  IF v_tarifa_resuelta.tarifa_id IS NULL THEN
    v_dia_nombre := CASE EXTRACT(ISODOW FROM p_fecha)::INT
      WHEN 1 THEN 'lunes'
      WHEN 2 THEN 'martes'
      WHEN 3 THEN 'miércoles'
      WHEN 4 THEN 'jueves'
      WHEN 5 THEN 'viernes'
      WHEN 6 THEN 'sábados'
      WHEN 7 THEN 'domingos'
    END;
    RAISE EXCEPTION
      'No hay tarifa de clase configurada para los % a las %. Configurala en Configuración → Tarifas (pestaña Clases) antes de cobrar.',
      v_dia_nombre, to_char(v_clase.hora_inicio, 'HH24:MI');
  END IF;

  v_monto := v_tarifa_resuelta.monto;

  -- ── INSERT en clase_cobros (snapshot del monto resuelto). ─────────
  --    Mismo INSERT que 0023: incluye turno_caja_id.
  --    clase_cobros.monto es NOT NULL CHECK > 0 — el CHECK protege
  --    contra una tarifa resuelta de 0 (que no debería pasar por el
  --    CHECK monto > 0 de fn_crear_tarifa_clase, pero defensa en capas).
  INSERT INTO clase_cobros (
    club_id, clase_id, fecha, monto, medio_pago, observaciones, usuario_id,
    turno_caja_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, v_monto, p_medio_pago, p_observaciones,
    v_usuario_id, v_turno_caja_id
  )
  RETURNING * INTO v_cobro;

  RETURN v_cobro;
END;
$$;

COMMENT ON FUNCTION fn_cobrar_clase IS
  'Registra un cobro de una ocurrencia de clase. Modelo B (0035): el
   monto del alquiler se RESUELVE SERVER-SIDE via fn_resolver_tarifa_clase
   (no se recibe del caller). Snapshot del monto resuelto queda en
   clase_cobros.monto. Si no hay tarifa para el slot, RAISE con mensaje
   accionable. Mantiene todas las validaciones de 0023 (sesión, medio,
   caja si efectivo, FOR UPDATE, weekday).';

GRANT EXECUTE ON FUNCTION fn_cobrar_clase(
  BIGINT, DATE, VARCHAR, TEXT
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0035_cobro_clase_via_tarifa.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. La firma vieja YA NO EXISTE ----------
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc WHERE proname = 'fn_cobrar_clase';
-- → Debe listar UNA sola fila con args:
--   "p_clase_id bigint, p_fecha date, p_medio_pago character varying, p_observaciones text"
--   (NO debe aparecer la versión con p_monto numeric).

-- ---------- B. ALTER clases.precio default 0 ----------
-- SELECT column_default FROM information_schema.columns
-- WHERE table_name = 'clases' AND column_name = 'precio';
-- → '0'

-- ---------- C. Llamar con firma vieja → debe fallar ----------
-- Como vendedor:
--   await window.supabase.rpc('fn_cobrar_clase', {
--     p_clase_id: <id>, p_fecha: '2026-05-22',
--     p_monto: 1000, p_medio_pago: 'efectivo', p_observaciones: null
--   });
-- → ERROR: no function matches the given name and argument types
--   (porque ya no existe la firma con p_monto).

-- ---------- D. Cobrar clase CON tarifa configurada ----------
-- Pre-requisito: tener una tarifa de clase que cubra el horario de la
-- clase (ej. fn_crear_tarifa_clase con desde_hora/hasta_hora apropiados).
-- Como vendedor con caja abierta:
--   await window.supabase.rpc('fn_cobrar_clase', {
--     p_clase_id: <id>, p_fecha: '2026-05-22',
--     p_medio_pago: 'efectivo', p_observaciones: null
--   });
-- → { data: { id, monto: <tarifa resuelta>, turno_caja_id: <id>, ... } }
-- Verificar: SELECT id, monto, turno_caja_id FROM clase_cobros
--            WHERE clase_id = <id> ORDER BY fecha_hora DESC LIMIT 1;
-- → monto = el de la tarifa de clase vigente para esa fecha+hora.

-- ---------- E. LA CRÍTICA — cobrar clase SIN tarifa configurada ----------
-- Sobre una clase en horario sin tarifa (ej. domingos 03:00 sin
-- tarifa configurada para ese slot):
--   await window.supabase.rpc('fn_cobrar_clase', {
--     p_clase_id: <id_sin_tarifa>, p_fecha: '2026-05-24',  -- domingo
--     p_medio_pago: 'efectivo', p_observaciones: null
--   });
-- → ERROR: 'No hay tarifa de clase configurada para los domingos a las
--   03:00. Configurala en Configuración → Tarifas (pestaña Clases) antes
--   de cobrar.'
-- (Sin fila insertada en clase_cobros.)

-- ---------- F. Snapshot — si cambia la tarifa después, el cobro NO se mueve ----------
-- 1. Cobrar la clase D (monto1 = X).
-- 2. Cambiar la tarifa de clase via fn_cambiar_precio_tarifa_clase
--    (aumento programado para fecha futura, o cambio inmediato).
-- 3. SELECT monto FROM clase_cobros WHERE id = <cobro D>;
-- → Sigue siendo X (snapshot intacto).

-- ---------- G. Caja en efectivo (PRESERVADA) ----------
-- Sin caja abierta, intentar cobrar en efectivo:
-- → ERROR: 'No hay caja abierta...'
-- En transferencia/mp/tarjeta/otro: no requiere caja. OK.

-- ---------- H. Weekday (PRESERVADA) ----------
-- Cobrar una clase del lunes para una fecha que cae en martes:
-- → ERROR: 'La clase no se dicta el ...'

-- ---------- I. Múltiples pagos por (clase, fecha) (PRESERVADO desde 0008) ----------
-- Cobrar la misma (clase, fecha) dos veces seguidas:
-- → Las dos llamadas insertan fila nueva (la UNIQUE fue dropeada en
--   0008). Cada cobro inserta el monto de tarifa vigente.

-- ---------- J. INSERT directo en clases SIN precio ----------
-- Después del ALTER (default 0), un INSERT sin precio debe funcionar:
--   INSERT INTO clases (club_id, profesor_id, cancha_id, dias_semana,
--                       hora_inicio, duracion_min)
--   VALUES (1, <prof_id>, <cancha_id>, '{1,3,5}', '10:00', 60);
-- → OK, precio = 0 por default.

-- ---------- K. GRANT EXECUTE en la firma nueva ----------
-- SELECT has_function_privilege('authenticated',
--   'fn_cobrar_clase(BIGINT, DATE, VARCHAR, TEXT)', 'execute');
-- → true
-- ============================================================================
