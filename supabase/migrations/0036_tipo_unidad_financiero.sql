-- ============================================================================
-- 0036_tipo_unidad_financiero.sql
-- Agrega el tipo de unidad 'financiero' al modelo (0027) para separar
-- los gastos bancarios/comisiones/intereses como capa propia del EERR
-- corporativo ("Resultados financieros").
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- 1. Reemplaza los 3 CHECKs inline de la 0027 que limitan los valores
--    de tipo/unidad_tipo, sumando 'financiero' a la lista:
--      - unidades_negocio.tipo
--      - gastos.unidad_tipo (snapshot)
--      - otros_ingresos.unidad_tipo (snapshot)
--    Como los CHECKs fueron declarados inline (sin CONSTRAINT name),
--    PostgreSQL les asignó nombres autogenerados. Usamos DO blocks que
--    DESCUBREN el constraint por el contenido (LIKE sobre la def) y lo
--    dropean dinámicamente. Después agregamos el nuevo con nombre fijo
--    y consistente (<tabla>_<col>_check).
--
-- 2. Extiende fn_inicializar_finanzas para incluir la unidad
--    "Financiero" + 4 categorías default (Comisiones bancarias,
--    Comisiones MP/tarjetas, Intereses pagados, Mantenimiento de
--    cuenta). Pasa de 5 unidades + 19 categorías a 6 unidades + 23
--    categorías. (NOTA: el COMMENT de la 0027 decía "17" por un bug
--    de conteo en la doc — el body de la 0027 ya sembraba 19. Mi
--    0036 mantiene IDÉNTICAS las 19 originales y suma 4 nuevas.)
--
-- 3. Backfill para clubes existentes: re-ejecuta el alta de Financiero
--    + categorías llamando directo a las helpers _fin_init_*. Las
--    helpers usan ON CONFLICT DO NOTHING → idempotente.
--
-- =====================================================================
-- "GASTOS BANCARIOS" EN ESTRUCTURA — DECISIÓN
-- =====================================================================
-- La categoría "Gastos bancarios" en Estructura (0027 línea 603) NO se
-- migra. Los gastos viejos cargados con ese snapshot mantienen su
-- clasificación histórica. Los gastos NUEVOS de comisiones bancarias
-- van a la unidad Financiero (que ahora existe). El admin puede
-- desactivar la categoría vieja desde la UI cuando confirme que ya no
-- la necesita.
--
-- =====================================================================
-- RIESGO
-- =====================================================================
-- - ALTER del CHECK: AGREGAR valores no invalida datos existentes
--   (cero filas se vuelven inválidas). Solo rompería si quitáramos
--   valores con filas — no es el caso.
-- - DROP del CHECK viejo con nombre dinámico: el FOR loop solo dropea
--   los que matchean el LIKE; si nada matchea (caso edge improbable),
--   el ADD del nuevo igual funciona porque no hay conflicto.
-- - Re-ejecución de fn_inicializar_finanzas: idempotente, documentado.
-- - 'financiero' NO se agrega al UNIQUE PARCIAL
--   unidades_negocio_tipo_unico_si_automatico (decisión: mismo patrón
--   que estructura, técnicamente un club podría tener 2 "Financiero").
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Reemplazar los 3 CHECKs de tipo/unidad_tipo
-- ============================================================================
--    Para cada tabla:
--      a) DO block descubre el CHECK actual sobre tipo/unidad_tipo
--         (filtro por LIKE sobre la def del constraint).
--      b) DROPea ese constraint (incluso si ya tiene 'financiero', se
--         vuelve a crear igual → idempotente para re-corridas).
--      c) ADD el constraint nuevo con nombre fijo + lista extendida.
-- ============================================================================

-- 1.a — unidades_negocio.tipo
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'unidades_negocio'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%canchas%clases%buffet%shop%'
  LOOP
    EXECUTE format('ALTER TABLE unidades_negocio DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE unidades_negocio
  ADD CONSTRAINT unidades_negocio_tipo_check CHECK (tipo IN (
    'canchas','clases','buffet','shop',
    'auspicios','membresias','estructura','financiero','otro'
  ));


-- 1.b — gastos.unidad_tipo (snapshot)
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'gastos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%canchas%clases%buffet%shop%'
  LOOP
    EXECUTE format('ALTER TABLE gastos DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE gastos
  ADD CONSTRAINT gastos_unidad_tipo_check CHECK (unidad_tipo IN (
    'canchas','clases','buffet','shop',
    'auspicios','membresias','estructura','financiero','otro'
  ));


-- 1.c — otros_ingresos.unidad_tipo (snapshot)
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'otros_ingresos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%canchas%clases%buffet%shop%'
  LOOP
    EXECUTE format('ALTER TABLE otros_ingresos DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE otros_ingresos
  ADD CONSTRAINT otros_ingresos_unidad_tipo_check CHECK (unidad_tipo IN (
    'canchas','clases','buffet','shop',
    'auspicios','membresias','estructura','financiero','otro'
  ));


-- ============================================================================
-- 2. CREATE OR REPLACE fn_inicializar_finanzas
-- ============================================================================
--    Cambios respecto a 0027:
--      - DECLARE: + v_u_financiero BIGINT, v_u_financiero_creada BOOLEAN.
--      - UNIDADES: + Financiero (tipo 'financiero', orden 60) DESPUÉS
--        de Estructura.
--      - CATEGORÍAS: + 4 default en Financiero (Comisiones bancarias,
--        Comisiones MP/tarjetas, Intereses pagados, Mantenimiento de
--        cuenta).
--      - Sigue idempotente. El gate y el body son IDÉNTICOS al de 0027.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_inicializar_finanzas(p_club_id BIGINT)
RETURNS TABLE (
  unidades_creadas INT,
  categorias_creadas INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_club_id BIGINT;
  v_caller_rol VARCHAR;
  v_u_canchas BIGINT;       v_u_canchas_creada BOOLEAN;
  v_u_clases BIGINT;        v_u_clases_creada BOOLEAN;
  v_u_buffet BIGINT;        v_u_buffet_creada BOOLEAN;
  v_u_shop BIGINT;          v_u_shop_creada BOOLEAN;
  v_u_estructura BIGINT;    v_u_estructura_creada BOOLEAN;
  v_u_financiero BIGINT;    v_u_financiero_creada BOOLEAN;  -- NUEVO 0036
  v_unidades INT := 0;
  v_categorias INT := 0;
BEGIN
  -- =================================================================
  -- GATE de seguridad (idéntico a 0027).
  -- =================================================================
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_caller_club_id := current_club_id();
    v_caller_rol := current_user_rol();

    IF v_caller_club_id IS NULL THEN
      RAISE EXCEPTION 'No hay sesión activa.';
    END IF;
    IF v_caller_club_id <> p_club_id THEN
      RAISE EXCEPTION 'Solo podés inicializar las finanzas de tu propio club.';
    END IF;
    IF v_caller_rol IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Solo el administrador del club puede inicializar las finanzas.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clubes WHERE id = p_club_id) THEN
    RAISE EXCEPTION 'Club no encontrado.';
  END IF;

  -- =================================================================
  -- UNIDADES (6 ahora — antes 5)
  -- =================================================================
  SELECT v_id, v_creada INTO v_u_canchas, v_u_canchas_creada
  FROM _fin_init_unidad(p_club_id, 'Canchas', 'canchas', 10);
  IF v_u_canchas_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_clases, v_u_clases_creada
  FROM _fin_init_unidad(p_club_id, 'Clases', 'clases', 20);
  IF v_u_clases_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_buffet, v_u_buffet_creada
  FROM _fin_init_unidad(p_club_id, 'Buffet', 'buffet', 30);
  IF v_u_buffet_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_shop, v_u_shop_creada
  FROM _fin_init_unidad(p_club_id, 'Shop', 'shop', 40);
  IF v_u_shop_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_estructura, v_u_estructura_creada
  FROM _fin_init_unidad(p_club_id, 'Estructura', 'estructura', 50);
  IF v_u_estructura_creada THEN v_unidades := v_unidades + 1; END IF;

  -- ⭐ NUEVO 0036 — Unidad Financiero
  SELECT v_id, v_creada INTO v_u_financiero, v_u_financiero_creada
  FROM _fin_init_unidad(p_club_id, 'Financiero', 'financiero', 60);
  IF v_u_financiero_creada THEN v_unidades := v_unidades + 1; END IF;

  -- =================================================================
  -- CATEGORÍAS (23 ahora — antes 19; el COMMENT de la 0027 decía "17"
  -- por un error de conteo en la doc, el body real ya sembraba 19).
  -- =================================================================

  -- Canchas (3)
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Mantenimiento canchas', 10) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Iluminación', 20)          THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Productos limpieza', 30)   THEN v_categorias := v_categorias + 1; END IF;

  -- Clases (2)
  IF _fin_init_categoria(p_club_id, v_u_clases, 'Pagos a profesores', 10) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_clases, 'Material didáctico', 20) THEN v_categorias := v_categorias + 1; END IF;

  -- Buffet (2)
  IF _fin_init_categoria(p_club_id, v_u_buffet, 'Mercadería', 10)         THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_buffet, 'Reposición vajilla', 20) THEN v_categorias := v_categorias + 1; END IF;

  -- Shop (2)
  IF _fin_init_categoria(p_club_id, v_u_shop, 'Mercadería shop', 10)      THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_shop, 'Marketing artículos', 20)  THEN v_categorias := v_categorias + 1; END IF;

  -- Estructura (10) — INTACTO. "Gastos bancarios" se mantiene aquí
  -- por compat con gastos históricos snapshoteados.
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Alquiler local', 10)              THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Servicios (luz/agua/gas/internet)', 20) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Sueldos y cargas sociales', 30)   THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Impuestos y tasas', 40)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Mantenimiento general', 50)       THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Limpieza', 60)                    THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Marketing general', 70)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Insumos oficina', 80)             THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Gastos bancarios', 90)            THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Otros', 100)                      THEN v_categorias := v_categorias + 1; END IF;

  -- ⭐ NUEVO 0036 — Financiero (4 categorías)
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Comisiones bancarias', 10)        THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Comisiones MP / tarjetas', 20)    THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Intereses pagados', 30)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Mantenimiento de cuenta', 40)     THEN v_categorias := v_categorias + 1; END IF;

  RAISE NOTICE 'fn_inicializar_finanzas para club %: % unidad(es) creadas, % categoría(s) creadas (idempotente).',
    p_club_id, v_unidades, v_categorias;

  RETURN QUERY SELECT v_unidades, v_categorias;
END;
$$;

COMMENT ON FUNCTION fn_inicializar_finanzas(BIGINT) IS
  'Siembra 6 unidades y 23 categorías de gasto típicas de un club de
   pádel (incluye Financiero desde 0036; la 0027 sembraba 19 aunque su
   COMMENT decía 17 — bug histórico de doc, no de body). Idempotente —
   re-ejecutable sin duplicar (helpers internas usan ON CONFLICT DO
   NOTHING). Gate: solo admin del propio club, o service_role para
   invocaciones desde Edge Functions futuras.';


-- ============================================================================
-- 3. Backfill — crear unidad Financiero + 4 categorías en cada club existente
-- ============================================================================
--    Llama directo a las helpers _fin_init_* (también SECURITY DEFINER,
--    sin gate). Más predecible que invocar fn_inicializar_finanzas
--    completa: el backfill solo agrega lo nuevo, no toca lo viejo.
--
--    Idempotente: si la unidad/categoría ya existe (caso re-corrida),
--    el ON CONFLICT DO NOTHING en las helpers no crea duplicados.
-- ============================================================================
DO $$
DECLARE
  v_club_id BIGINT;
  v_u_id BIGINT;
  -- Nombre distinto al de la columna devuelta por _fin_init_unidad
  -- (que se llama v_creada por su OUT param). Sin este renombrado,
  -- el SELECT INTO da "column reference v_creada is ambiguous" (42702).
  v_fue_creada BOOLEAN;
  v_total_unidades INT := 0;
  v_total_categorias INT := 0;
BEGIN
  FOR v_club_id IN SELECT id FROM clubes LOOP
    -- Unidad Financiero
    SELECT v_id, v_creada INTO v_u_id, v_fue_creada
    FROM _fin_init_unidad(v_club_id, 'Financiero', 'financiero', 60);
    IF v_fue_creada THEN v_total_unidades := v_total_unidades + 1; END IF;

    -- Categorías
    IF _fin_init_categoria(v_club_id, v_u_id, 'Comisiones bancarias', 10) THEN
      v_total_categorias := v_total_categorias + 1;
    END IF;
    IF _fin_init_categoria(v_club_id, v_u_id, 'Comisiones MP / tarjetas', 20) THEN
      v_total_categorias := v_total_categorias + 1;
    END IF;
    IF _fin_init_categoria(v_club_id, v_u_id, 'Intereses pagados', 30) THEN
      v_total_categorias := v_total_categorias + 1;
    END IF;
    IF _fin_init_categoria(v_club_id, v_u_id, 'Mantenimiento de cuenta', 40) THEN
      v_total_categorias := v_total_categorias + 1;
    END IF;
  END LOOP;

  RAISE NOTICE
    'Backfill 0036 completo: % unidad(es) Financiero creadas, % categoría(s) creadas en clubes existentes.',
    v_total_unidades, v_total_categorias;
END $$;


COMMIT;

-- ============================================================================
-- Fin de la migración 0036_tipo_unidad_financiero.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Los 3 CHECKs aceptan 'financiero' ----------
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid IN (
--   'unidades_negocio'::regclass,
--   'gastos'::regclass,
--   'otros_ingresos'::regclass
-- )
--   AND contype = 'c'
--   AND pg_get_constraintdef(oid) LIKE '%canchas%clases%buffet%shop%';
-- → 3 filas (una por tabla), todas con 'financiero' incluido en la lista.

-- ---------- B. INSERT manual con tipo='financiero' funciona ----------
-- Como admin de Signo, intentar crear una unidad de prueba:
--   INSERT INTO unidades_negocio (club_id, nombre, tipo, orden)
--   VALUES (1, 'Test financiero', 'financiero', 999);
-- → OK (después: DELETE para limpiar).

-- ---------- C. Backfill: cada club tiene unidad "Financiero" ----------
-- SELECT c.id AS club_id, c.nombre AS club, u.nombre AS unidad, u.tipo
-- FROM clubes c
-- LEFT JOIN unidades_negocio u
--   ON u.club_id = c.id AND u.tipo = 'financiero'
-- ORDER BY c.id;
-- → Cada club tiene una fila con unidad 'Financiero'.

-- ---------- D. Categorías de Financiero por club ----------
-- SELECT u.nombre AS unidad, cg.nombre AS categoria, cg.orden
-- FROM unidades_negocio u
-- JOIN categorias_gasto cg ON cg.unidad_id = u.id
-- WHERE u.tipo = 'financiero' AND u.club_id = 1
-- ORDER BY cg.orden;
-- → 4 filas: Comisiones bancarias, Comisiones MP / tarjetas,
--   Intereses pagados, Mantenimiento de cuenta.

-- ---------- E. Idempotencia ----------
-- Volver a ejecutar el backfill (copy/paste del DO block de la sección 3).
-- → Debe imprimir: '0 unidad(es) Financiero creadas, 0 categoría(s) creadas'.
-- → SELECT count(*) FROM unidades_negocio WHERE tipo='financiero' AND club_id=1;
--   sigue siendo 1.

-- ---------- F. fn_inicializar_finanzas para un club NUEVO ----------
-- Si se crea un club nuevo via Edge Function (service_role), la fn ya
-- incluye Financiero en el set de fábrica. Verificable con:
--   await window.supabase.rpc('fn_inicializar_finanzas', { p_club_id: <nuevo> });
-- → 6 unidades creadas, 23 categorías creadas (en un club totalmente nuevo).

-- ---------- G. Gastos existentes con 'Gastos bancarios' en Estructura ----------
-- SELECT count(*) FROM gastos
-- WHERE club_id = 1 AND categoria_nombre = 'Gastos bancarios'
--   AND unidad_tipo = 'estructura';
-- → Sin cambios. Los snapshots viejos se mantienen.

-- ---------- H. UNIQUE PARCIAL no incluye 'financiero' (intencional) ----------
-- SELECT indexdef FROM pg_indexes
-- WHERE indexname = 'unidades_negocio_tipo_unico_si_automatico';
-- → Sigue diciendo "WHERE (tipo = ANY (ARRAY['canchas','clases','buffet','shop']))"
--   (no se tocó). Un club PODRÍA tener 2 unidades "Financiero" — mismo
--   comportamiento que con "Estructura". Aceptado en el plan.
-- ============================================================================
