-- ============================================================================
-- 0096_finanzas_unidades_fijas_y_clasificacion.sql
-- Módulo Financiero — Fase 1 (Unidades fijas y clasificación de costos).
--
-- =====================================================================
-- DETALLE DE CAMBIOS
-- =====================================================================
-- 1. Agrega el tipo de unidad 'torneos' a los CHECK constraints de:
--      - unidades_negocio.tipo
--      - gastos.unidad_tipo (snapshot)
--      - otros_ingresos.unidad_tipo (snapshot)
--
-- 2. Agrega la columna `clasificacion` a `categorias_gasto` y `gastos`
--    con valores: DIRECT_MERCHANDISE, DIRECT_OTHER, STRUCTURE, FINANCIAL.
--
-- 3. Redefine fn_inicializar_finanzas(p_club_id) para sembrar las 8 unidades
--    fijas por defecto (Canchas, Escuela, Torneos y Eventos, Buffet, Shop,
--    Auspicios, Estructura, Financiero) e inicializar la clasificación de cada
--    categoría por defecto.
--
-- 4. Ejecuta el bloque DO de Backfill Histórico:
--      - Renombra la unidad 'Clases' a 'Escuela' (manteniendo tipo='clases').
--      - Crea las unidades faltantes ('Torneos y Eventos', 'Auspicios') para todos los clubes.
--      - Mapea clasificaciones de categorías existentes y actualiza los snapshots en gastos.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Modificación de CHECK Constraints para incluir 'torneos'
-- ============================================================================

-- 1.a — unidades_negocio.tipo
ALTER TABLE unidades_negocio DROP CONSTRAINT IF EXISTS unidades_negocio_tipo_check;
ALTER TABLE unidades_negocio ADD CONSTRAINT unidades_negocio_tipo_check CHECK (tipo IN (
  'canchas','clases','buffet','shop','auspicios','membresias','estructura','financiero','torneos','otro'
));

-- 1.b — gastos.unidad_tipo (snapshot)
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_unidad_tipo_check;
ALTER TABLE gastos ADD CONSTRAINT gastos_unidad_tipo_check CHECK (unidad_tipo IN (
  'canchas','clases','buffet','shop','auspicios','membresias','estructura','financiero','torneos','otro'
));

-- 1.c — otros_ingresos.unidad_tipo (snapshot)
ALTER TABLE otros_ingresos DROP CONSTRAINT IF EXISTS otros_ingresos_unidad_tipo_check;
ALTER TABLE otros_ingresos ADD CONSTRAINT otros_ingresos_unidad_tipo_check CHECK (unidad_tipo IN (
  'canchas','clases','buffet','shop','auspicios','membresias','estructura','financiero','torneos','otro'
));


-- ============================================================================
-- 2. Agregar columnas de clasificación de costos
-- ============================================================================

-- 2.a — categorias_gasto.clasificacion
ALTER TABLE categorias_gasto ADD COLUMN IF NOT EXISTS clasificacion VARCHAR(30) DEFAULT 'STRUCTURE';

ALTER TABLE categorias_gasto DROP CONSTRAINT IF EXISTS categorias_gasto_clasificacion_check;
ALTER TABLE categorias_gasto ADD CONSTRAINT categorias_gasto_clasificacion_check CHECK (clasificacion IN (
  'DIRECT_MERCHANDISE', 'DIRECT_OTHER', 'STRUCTURE', 'FINANCIAL'
));

-- 2.b — gastos.clasificacion (snapshot)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS clasificacion VARCHAR(30) DEFAULT 'STRUCTURE';

ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_clasificacion_check;
ALTER TABLE gastos ADD CONSTRAINT gastos_clasificacion_check CHECK (clasificacion IN (
  'DIRECT_MERCHANDISE', 'DIRECT_OTHER', 'STRUCTURE', 'FINANCIAL'
));


-- ============================================================================
-- 3. Redefinición de fn_inicializar_finanzas
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
  v_u_torneos BIGINT;       v_u_torneos_creada BOOLEAN;
  v_u_auspicios BIGINT;     v_u_auspicios_creada BOOLEAN;
  v_u_estructura BIGINT;    v_u_estructura_creada BOOLEAN;
  v_u_financiero BIGINT;    v_u_financiero_creada BOOLEAN;
  v_unidades INT := 0;
  v_categorias INT := 0;
BEGIN
  -- Gate de seguridad
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

  -- 1. Sembrar las 8 unidades maestras fijas
  SELECT v_id, v_creada INTO v_u_canchas, v_u_canchas_creada
  FROM _fin_init_unidad(p_club_id, 'Canchas', 'canchas', 10);
  IF v_u_canchas_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_clases, v_u_clases_creada
  FROM _fin_init_unidad(p_club_id, 'Escuela', 'clases', 20); -- Nombre Escuela, tipo clases
  IF v_u_clases_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_buffet, v_u_buffet_creada
  FROM _fin_init_unidad(p_club_id, 'Buffet', 'buffet', 30);
  IF v_u_buffet_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_shop, v_u_shop_creada
  FROM _fin_init_unidad(p_club_id, 'Shop', 'shop', 40);
  IF v_u_shop_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_torneos, v_u_torneos_creada
  FROM _fin_init_unidad(p_club_id, 'Torneos y Eventos', 'torneos', 50);
  IF v_u_torneos_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_auspicios, v_u_auspicios_creada
  FROM _fin_init_unidad(p_club_id, 'Auspicios', 'auspicios', 60);
  IF v_u_auspicios_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_estructura, v_u_estructura_creada
  FROM _fin_init_unidad(p_club_id, 'Estructura', 'estructura', 70);
  IF v_u_estructura_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_financiero, v_u_financiero_creada
  FROM _fin_init_unidad(p_club_id, 'Financiero', 'financiero', 80);
  IF v_u_financiero_creada THEN v_unidades := v_unidades + 1; END IF;

  -- 2. Sembrar categorías con sus respectivas clasificaciones
  
  -- Canchas (Estructura por defecto)
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Mantenimiento canchas', 10) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Iluminación', 20)          THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Productos limpieza', 30)   THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_canchas;

  -- Escuela (Variable para pagos a profesores, Fijo para materiales)
  IF _fin_init_categoria(p_club_id, v_u_clases, 'Pagos a profesores', 10) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_clases, 'Material didáctico', 20) THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'DIRECT_OTHER' WHERE unidad_id = v_u_clases AND nombre = 'Pagos a profesores';
  UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_clases AND nombre = 'Material didáctico';

  -- Buffet (Mercadería de reventa, Reposición vajilla fija)
  IF _fin_init_categoria(p_club_id, v_u_buffet, 'Mercadería', 10)         THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_buffet, 'Reposición vajilla', 20) THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'DIRECT_MERCHANDISE', es_mercaderia = TRUE WHERE unidad_id = v_u_buffet AND nombre = 'Mercadería';
  UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_buffet AND nombre = 'Reposición vajilla';

  -- Shop (Mercadería de reventa, Marketing fijo)
  IF _fin_init_categoria(p_club_id, v_u_shop, 'Mercadería shop', 10)      THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_shop, 'Marketing artículos', 20)  THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'DIRECT_MERCHANDISE', es_mercaderia = TRUE WHERE unidad_id = v_u_shop AND nombre = 'Mercadería shop';
  UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_shop AND nombre = 'Marketing artículos';

  -- Torneos y Eventos (Premios/Arbitraje directos, Insumos fijos)
  IF _fin_init_categoria(p_club_id, v_u_torneos, 'Premios', 10)                      THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_torneos, 'Arbitraje y Organización', 20)     THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_torneos, 'Insumos de eventos', 30)           THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'DIRECT_OTHER' WHERE unidad_id = v_u_torneos AND nombre IN ('Premios', 'Arbitraje y Organización');
  UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_torneos AND nombre = 'Insumos de eventos';

  -- Auspicios (Producción cartelera fija)
  IF _fin_init_categoria(p_club_id, v_u_auspicios, 'Producción cartelera', 10)       THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_auspicios;

  -- Estructura (Gastos de estructura fijos)
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Alquiler local', 10)              THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Servicios (luz/agua/gas/internet)', 20) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Sueldos y cargas sociales', 30)   THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Impuestos y taxas', 40)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Mantenimiento general', 50)       THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Limpieza', 60)                    THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Marketing general', 70)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Insumos oficina', 80)             THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Gastos bancarios', 90)            THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Otros', 100)                      THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_estructura;

  -- Financiero (Financieros)
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Comisiones bancarias', 10)        THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Comisiones MP / tarjetas', 20)    THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Intereses pagados', 30)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Mantenimiento de cuenta', 40)     THEN v_categorias := v_categorias + 1; END IF;
  UPDATE categorias_gasto SET clasificacion = 'FINANCIAL' WHERE unidad_id = v_u_financiero;

  RETURN QUERY SELECT v_unidades, v_categorias;
END;
$$;


-- ============================================================================
-- 4. Bloque DO de Backfill Histórico
-- ============================================================================

DO $$
DECLARE
  v_club_id BIGINT;
  v_u_id BIGINT;
  v_fue_creada BOOLEAN;
  v_count_unidades INT := 0;
  v_count_categorias INT := 0;
BEGIN
  -- 4.a — Renombrar la unidad 'Clases' a 'Escuela' para consistencia visual (tipo 'clases' queda igual)
  UPDATE unidades_negocio
  SET nombre = 'Escuela'
  WHERE tipo = 'clases' AND lower(nombre) = 'clases';

  -- 4.b — Asegurar la existencia de las 8 unidades fijas para cada club existente
  FOR v_club_id IN SELECT id FROM clubes LOOP
    -- Sembramos 'Torneos y Eventos'
    SELECT v_id, v_creada INTO v_u_id, v_fue_creada
    FROM _fin_init_unidad(v_club_id, 'Torneos y Eventos', 'torneos', 50);
    IF v_fue_creada THEN v_count_unidades := v_count_unidades + 1; END IF;

    -- Categorías por defecto para Torneos
    IF _fin_init_categoria(v_club_id, v_u_id, 'Premios', 10) THEN v_count_categorias := v_count_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_id, 'Arbitraje y Organización', 20) THEN v_count_categorias := v_count_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_id, 'Insumos de eventos', 30) THEN v_count_categorias := v_count_categorias + 1; END IF;

    -- Sembramos 'Auspicios'
    SELECT v_id, v_creada INTO v_u_id, v_fue_creada
    FROM _fin_init_unidad(v_club_id, 'Auspicios', 'auspicios', 60);
    IF v_fue_creada THEN v_count_unidades := v_count_unidades + 1; END IF;

    -- Categorías por defecto para Auspicios
    IF _fin_init_categoria(v_club_id, v_u_id, 'Producción cartelera', 10) THEN v_count_categorias := v_count_categorias + 1; END IF;
  END LOOP;

  RAISE NOTICE 'Backfill: Sembradas % unidades y % categorías nuevas en clubes existentes.', v_count_unidades, v_count_categorias;

  -- 4.c — Mapear clasificaciones de categorias_gasto existentes
  --   1. Mercadería -> DIRECT_MERCHANDISE (para Buffet y Shop con flag es_mercaderia)
  UPDATE categorias_gasto
  SET clasificacion = 'DIRECT_MERCHANDISE'
  WHERE es_mercaderia = TRUE;

  --   2. Financiero -> FINANCIAL
  UPDATE categorias_gasto cg
  SET clasificacion = 'FINANCIAL'
  FROM unidades_negocio u
  WHERE cg.unidad_id = u.id AND u.tipo = 'financiero';

  --   3. Pagos a profesores -> DIRECT_OTHER (costo directo variable de la escuela)
  UPDATE categorias_gasto cg
  SET clasificacion = 'DIRECT_OTHER'
  FROM unidades_negocio u
  WHERE cg.unidad_id = u.id AND u.tipo = 'clases' AND cg.nombre ILIKE '%profesor%';

  --   4. Premios y Arbitraje -> DIRECT_OTHER (costo directo de Torneos y Eventos)
  UPDATE categorias_gasto cg
  SET clasificacion = 'DIRECT_OTHER'
  FROM unidades_negocio u
  WHERE cg.unidad_id = u.id AND u.tipo = 'torneos' AND cg.nombre IN ('Premios', 'Arbitraje y Organización');

  --   5. Resto de categorías por defecto -> STRUCTURE (sueldos, servicios, alquiler, mantenimiento, etc.)
  --      Esto también cubre de manera segura cualquier categoría ambigua creada por los clubes.
  UPDATE categorias_gasto
  SET clasificacion = 'STRUCTURE'
  WHERE clasificacion IS NULL OR clasificacion = 'STRUCTURE';

  -- 4.d — Copiar el snapshot de clasificación a los gastos históricos cargados
  UPDATE gastos g
  SET clasificacion = cg.clasificacion
  FROM categorias_gasto cg
  WHERE g.categoria_id = cg.id;

  RAISE NOTICE 'Backfill: Clasificaciones mapeadas e historial de gastos actualizado con éxito.';
END $$;

COMMIT;
