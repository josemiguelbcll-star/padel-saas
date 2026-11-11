-- ============================================================================
-- 0155_reseed_unidades_negocio.sql
--
-- Restaura el catálogo financiero estándar (8 unidades de negocio + sus
-- categorías de gasto por defecto) para los clubes que quedaron SIN filas
-- en `unidades_negocio`.
--
-- Síntoma que corrige: la pantalla "Configuración → Unidades de negocio"
-- aparece vacía ("No hay unidades cargadas") sin arrojar error, porque el
-- SELECT devuelve 0 filas (RLS OK, tabla sin datos). Como las categorías
-- dependen de las unidades (FK ON DELETE RESTRICT), un club sin unidades
-- tampoco tiene categorías.
--
-- Alcance (conservador e idempotente):
--   - Solo actúa sobre clubes con CERO unidades. Si un club ya tiene
--     alguna unidad, se saltea por completo (no toca catálogos existentes
--     ni puede violar el índice único de tipo canchas/clases/buffet/shop).
--   - Reutiliza los helpers internos `_fin_init_unidad` / `_fin_init_categoria`
--     definidos en 0027, con los nombres/orden/clasificaciones de 0096.
--   - No modifica RLS, policies ni grants.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_club_id BIGINT;
  v_clubes_afectados INT := 0;
  v_unidades INT := 0;
  v_categorias INT := 0;

  v_u_canchas BIGINT;      v_u_clases BIGINT;
  v_u_buffet BIGINT;       v_u_shop BIGINT;
  v_u_torneos BIGINT;      v_u_auspicios BIGINT;
  v_u_estructura BIGINT;   v_u_financiero BIGINT;
  v_creada BOOLEAN;
BEGIN
  FOR v_club_id IN
    SELECT c.id
    FROM clubes c
    WHERE NOT EXISTS (
      SELECT 1 FROM unidades_negocio u WHERE u.club_id = c.id
    )
    ORDER BY c.id
  LOOP
    v_clubes_afectados := v_clubes_afectados + 1;

    -- 1. Sembrar las 8 unidades maestras fijas
    SELECT u.v_id, u.v_creada INTO v_u_canchas, v_creada
    FROM _fin_init_unidad(v_club_id, 'Canchas', 'canchas', 10) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    SELECT u.v_id, u.v_creada INTO v_u_clases, v_creada
    FROM _fin_init_unidad(v_club_id, 'Escuela', 'clases', 20) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    SELECT u.v_id, u.v_creada INTO v_u_buffet, v_creada
    FROM _fin_init_unidad(v_club_id, 'Buffet', 'buffet', 30) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    SELECT u.v_id, u.v_creada INTO v_u_shop, v_creada
    FROM _fin_init_unidad(v_club_id, 'Shop', 'shop', 40) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    SELECT u.v_id, u.v_creada INTO v_u_torneos, v_creada
    FROM _fin_init_unidad(v_club_id, 'Torneos y Eventos', 'torneos', 50) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    SELECT u.v_id, u.v_creada INTO v_u_auspicios, v_creada
    FROM _fin_init_unidad(v_club_id, 'Auspicios', 'auspicios', 60) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    SELECT u.v_id, u.v_creada INTO v_u_estructura, v_creada
    FROM _fin_init_unidad(v_club_id, 'Estructura', 'estructura', 70) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    SELECT u.v_id, u.v_creada INTO v_u_financiero, v_creada
    FROM _fin_init_unidad(v_club_id, 'Financiero', 'financiero', 80) AS u;
    IF v_creada THEN v_unidades := v_unidades + 1; END IF;

    -- 2. Sembrar categorías por defecto con su clasificación de costo

    -- Canchas (Estructura por defecto)
    IF _fin_init_categoria(v_club_id, v_u_canchas, 'Mantenimiento canchas', 10) THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_canchas, 'Iluminación', 20)           THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_canchas, 'Productos limpieza', 30)    THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_canchas;

    -- Escuela
    IF _fin_init_categoria(v_club_id, v_u_clases, 'Pagos a profesores', 10) THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_clases, 'Material didáctico', 20) THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'DIRECT_OTHER' WHERE unidad_id = v_u_clases AND nombre = 'Pagos a profesores';
    UPDATE categorias_gasto SET clasificacion = 'STRUCTURE'    WHERE unidad_id = v_u_clases AND nombre = 'Material didáctico';

    -- Buffet
    IF _fin_init_categoria(v_club_id, v_u_buffet, 'Mercadería', 10)          THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_buffet, 'Reposición vajilla', 20)  THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'DIRECT_MERCHANDISE', es_mercaderia = TRUE WHERE unidad_id = v_u_buffet AND nombre = 'Mercadería';
    UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_buffet AND nombre = 'Reposición vajilla';

    -- Shop
    IF _fin_init_categoria(v_club_id, v_u_shop, 'Mercadería shop', 10)     THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_shop, 'Marketing artículos', 20) THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'DIRECT_MERCHANDISE', es_mercaderia = TRUE WHERE unidad_id = v_u_shop AND nombre = 'Mercadería shop';
    UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_shop AND nombre = 'Marketing artículos';

    -- Torneos y Eventos
    IF _fin_init_categoria(v_club_id, v_u_torneos, 'Premios', 10)                  THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_torneos, 'Arbitraje y Organización', 20) THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_torneos, 'Insumos de eventos', 30)       THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'DIRECT_OTHER' WHERE unidad_id = v_u_torneos AND nombre IN ('Premios', 'Arbitraje y Organización');
    UPDATE categorias_gasto SET clasificacion = 'STRUCTURE'    WHERE unidad_id = v_u_torneos AND nombre = 'Insumos de eventos';

    -- Auspicios
    IF _fin_init_categoria(v_club_id, v_u_auspicios, 'Producción cartelera', 10) THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_auspicios;

    -- Estructura
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Alquiler local', 10)                      THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Servicios (luz/agua/gas/internet)', 20)   THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Sueldos y cargas sociales', 30)           THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Impuestos y taxas', 40)                   THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Mantenimiento general', 50)               THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Limpieza', 60)                            THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Marketing general', 70)                   THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Insumos oficina', 80)                     THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Gastos bancarios', 90)                    THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_estructura, 'Otros', 100)                              THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'STRUCTURE' WHERE unidad_id = v_u_estructura;

    -- Financiero
    IF _fin_init_categoria(v_club_id, v_u_financiero, 'Comisiones bancarias', 10)     THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_financiero, 'Comisiones MP / tarjetas', 20) THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_financiero, 'Intereses pagados', 30)        THEN v_categorias := v_categorias + 1; END IF;
    IF _fin_init_categoria(v_club_id, v_u_financiero, 'Mantenimiento de cuenta', 40)  THEN v_categorias := v_categorias + 1; END IF;
    UPDATE categorias_gasto SET clasificacion = 'FINANCIAL' WHERE unidad_id = v_u_financiero;
  END LOOP;

  RAISE NOTICE '0155: % club(es) sin unidades de negocio restaurados — % unidad(es) y % categoría(s) creadas.',
    v_clubes_afectados, v_unidades, v_categorias;
END $$;

COMMIT;
