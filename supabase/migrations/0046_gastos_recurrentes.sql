-- ============================================================================
-- 0046_gastos_recurrentes.sql
-- Módulo Gastos Recurrentes — catálogo de plantillas de gastos esperados
-- + vínculo desde gastos hacia la plantilla que lo originó.
--
-- ⚠️ ARCHIVO EN DOS PARTES. NO EJECUTAR HASTA QUE LA PARTE 2 ESTÉ APPENDEADA.
-- ─────────────────────────────────────────────────────────────────────────
--   PARTE 1 (este bloque): CREATE TABLE gastos_recurrentes + RLS + GRANTs +
--                          ALTER TABLE gastos ADD gasto_recurrente_id.
--   PARTE 2 (se agrega abajo antes de ejecutar): DROP + CREATE
--                          fn_registrar_gasto con 11º param p_gasto_recurrente_id.
--   Ambas partes comparten UNA SOLA transacción (un único BEGIN al inicio
--   y un único COMMIT al final, abajo en la PARTE 2). Esto evita que un
--   schema quede "a medias" si la PARTE 2 falla después de la PARTE 1.
-- ─────────────────────────────────────────────────────────────────────────
--
-- =====================================================================
-- CONCEPTO
-- =====================================================================
-- Una PLANTILLA de recurrentes es un gasto esperado cada mes (alquiler,
-- luz, agua, sueldos): concepto + categoría (define a qué unidad del
-- EERR va) + monto estimado + día de vencimiento. Vive como CATÁLOGO,
-- separado de los gastos reales.
--
-- Cuando llega el momento de cargar el gasto real, el frontend abre
-- NuevoGastoDialog PRE-LLENADO desde la plantilla y, al guardar, el
-- gasto resultante queda VINCULADO a la plantilla vía
-- gastos.gasto_recurrente_id. Eso permite al panel "Recurrentes del
-- mes" detectar qué plantillas ya tienen un real cargado y cuáles
-- siguen pendientes.
--
-- El gasto generado es un `gastos` normal: el EERR lo agrega por su
-- snapshot `unidad_tipo` sin tocar la nueva columna, y si nace
-- pendiente (sin `fecha_pago`), `fn_registrar_gasto` genera 1 cuota
-- en `gasto_cuotas` que aparece en CxP automáticamente (0045). El
-- vínculo a la plantilla es solo metadata para el panel.
--
-- =====================================================================
-- DECISIONES DEL DISEÑO (validadas con el dueño)
-- =====================================================================
-- - `dia_vencimiento` (1-31) es el DÍA del mes, no una fecha. El
--   frontend hace clamp al último día del mes cuando corresponde
--   (ej. plantilla con día 31 en febrero → 28/29).
-- - `frecuencia` enum cerrado con UN solo valor hoy ('mensual'). El
--   diseño deja el campo para sumar bimestral/trimestral/anual sin
--   migración destructiva más adelante.
-- - `proveedor_id` opcional. Útil para luz/internet/alquiler (link al
--   proveedor existente, FK a `proveedores` 0038). NULL para sueldos
--   (no es un proveedor formal en este modelo).
-- - `activo BOOLEAN` (no `fecha_baja`): desactivar preserva el
--   vínculo histórico de los reales ya generados (ON DELETE SET NULL
--   en `gastos.gasto_recurrente_id` por si después se elimina).
-- - UNIQUE (club_id, lower(concepto)) — incluso plantillas
--   desactivadas cuentan: forzamos al admin a reactivar la existente
--   en lugar de crear "Luz" duplicada. Mejor UX que duplicados
--   silenciosos.
-- - ABM admin-only (catálogo del negocio); SELECT abierto al club
--   (el vendedor lee el panel para saber qué cargar, aunque solo el
--   admin define la plantilla).
-- - DELETE habilitado (a diferencia de gastos/otros_ingresos que son
--   inmutables): una plantilla mal cargada puede borrarse limpiamente
--   antes de tener reales asociados; si tiene reales, el ON DELETE
--   SET NULL en gastos preserva el historial desligado.
-- =====================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: gastos_recurrentes
-- ============================================================================
--    Catálogo de plantillas. Cada fila representa "este gasto se espera
--    todos los meses" con su categoría (define a qué unidad del EERR
--    va el real que se cargue), monto estimado y día de vencimiento.
--
--    `categoria_id` es ON DELETE RESTRICT: si una categoría está siendo
--    referenciada por plantillas, no se puede borrar la categoría
--    (mismo patrón que `gastos`). Para "borrar" una categoría, se
--    desactiva (activa=FALSE en categorias_gasto).
--
--    `proveedor_id` es ON DELETE SET NULL: si se elimina el proveedor,
--    la plantilla queda sin proveedor pero sobrevive.
--
--    `categoria_id` y `proveedor_id` apuntan a tablas con club_id, pero
--    NO chequeamos cross-club en las policies (mismo patrón que
--    `gastos`): el admin del club solo VE las categorías/proveedores
--    de su club (RLS de esas tablas), así que en la UI no puede
--    elegir IDs ajenos. Si alguien forzara un INSERT directo con un
--    ID ajeno (ataque teórico, requiere conocer IDs SERIAL de otro
--    club), la plantilla quedaría "rota" pero NO se filtra info: al
--    intentar "Cargar real", fn_registrar_gasto re-valida la
--    categoría contra el club y rechaza. Cierre defensivo en el flujo.
-- ============================================================================
CREATE TABLE gastos_recurrentes (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  categoria_id BIGINT NOT NULL REFERENCES categorias_gasto(id) ON DELETE RESTRICT,
  proveedor_id BIGINT REFERENCES proveedores(id) ON DELETE SET NULL,

  concepto VARCHAR(120) NOT NULL,
  monto_estimado DECIMAL(12,2) NOT NULL CHECK (monto_estimado > 0),

  -- Día del mes (1-31). El frontend clampa al último día del mes para
  -- meses cortos (ej. día 31 en febrero → 28/29). NO es una fecha
  -- absoluta.
  dia_vencimiento SMALLINT NOT NULL CHECK (dia_vencimiento BETWEEN 1 AND 31),

  -- Enum cerrado. Hoy un solo valor. Cuando se sumen 'bimestral',
  -- 'trimestral', 'semestral', 'anual', se extiende el CHECK vía
  -- migración futura (mismo patrón que `unidad_tipo` en 0036).
  frecuencia VARCHAR(20) NOT NULL DEFAULT 'mensual'
    CHECK (frecuencia IN ('mensual')),

  observaciones TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,

  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidad case-insensitive del concepto por club. Incluye plantillas
-- desactivadas a propósito (forzamos a reactivar la existente en
-- lugar de crear duplicado).
CREATE UNIQUE INDEX gastos_recurrentes_unique_concepto
  ON gastos_recurrentes (club_id, lower(concepto));

-- Índice para el panel "del mes" (filtra activas, ordena por día de
-- vencimiento). El club_id queda primero por convención multi-tenant.
CREATE INDEX idx_gastos_recurrentes_club_activo_dia
  ON gastos_recurrentes (club_id, activo, dia_vencimiento);

-- Índice de la FK a categorias (acelera el JOIN del panel).
CREATE INDEX idx_gastos_recurrentes_categoria
  ON gastos_recurrentes (categoria_id);

-- Índice parcial de la FK a proveedores (la mayoría de plantillas
-- como "Sueldo Juan" no tienen proveedor; índice parcial ahorra
-- espacio sin penalizar las que sí lo tienen).
CREATE INDEX idx_gastos_recurrentes_proveedor
  ON gastos_recurrentes (proveedor_id) WHERE proveedor_id IS NOT NULL;

COMMENT ON TABLE gastos_recurrentes IS
  'Catálogo de plantillas de gastos recurrentes (alquiler, luz, sueldos).
   Las plantillas NO son movimientos contables; solo el panel
   "Recurrentes del mes" las usa para detectar qué falta cargar. El
   gasto real se crea via fn_registrar_gasto vinculado por
   gasto_recurrente_id.';

COMMENT ON COLUMN gastos_recurrentes.dia_vencimiento IS
  'Día del mes (1-31). NO es una fecha absoluta. El consumer clampa al
   último día del mes cuando el día no existe (ej. 31 en febrero → 28/29).';

COMMENT ON COLUMN gastos_recurrentes.frecuencia IS
  'Enum cerrado. Hoy solo "mensual". Futuro: bimestral, trimestral,
   semestral, anual (se extiende el CHECK vía migración cuando emerjan).';

COMMENT ON COLUMN gastos_recurrentes.monto_estimado IS
  'Monto fijo declarado por el admin. NO es un promedio automático del
   histórico (eso es evolución futura). Sirve para previsualizar en el
   panel; el real se carga editando este valor a la cifra exacta.';

COMMENT ON COLUMN gastos_recurrentes.activo IS
  'FALSE = la plantilla deja de aparecer en el panel del mes. Los
   gastos reales históricos ya generados conservan su gasto_recurrente_id
   y siguen apareciendo en el historial. Para reactivar: activo=TRUE.';


-- ============================================================================
-- 2. RLS y GRANTs — ABM admin-only, SELECT abierto al club
-- ============================================================================
--    Mismo patrón que `turnos_fijos` (0030/0033): el catálogo lo
--    administra el admin; el vendedor lo puede LEER (necesita ver el
--    panel del mes para saber qué falta cargar) pero NO escribir.
--    DELETE habilitado (admin-only) — el ON DELETE SET NULL en
--    gastos.gasto_recurrente_id preserva el historial.
-- ============================================================================

ALTER TABLE gastos_recurrentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gastos_recurrentes_select_propio_club"
ON gastos_recurrentes FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "gastos_recurrentes_insert_admin"
ON gastos_recurrentes FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "gastos_recurrentes_update_admin"
ON gastos_recurrentes FOR UPDATE TO authenticated
USING (club_id = current_club_id() AND current_user_rol() = 'admin')
WITH CHECK (club_id = current_club_id() AND current_user_rol() = 'admin');

CREATE POLICY "gastos_recurrentes_delete_admin"
ON gastos_recurrentes FOR DELETE TO authenticated
USING (club_id = current_club_id() AND current_user_rol() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON gastos_recurrentes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE gastos_recurrentes_id_seq TO authenticated;


-- ============================================================================
-- 3. ALTER gastos: + gasto_recurrente_id (FK, NULL, ON DELETE SET NULL)
-- ============================================================================
--    Vínculo opcional desde el gasto real hacia la plantilla que lo
--    originó. NULL en gastos manuales (sin plantilla) y en los
--    pre-existentes a esta migración.
--
--    ON DELETE SET NULL: si el admin borra la plantilla, el gasto
--    histórico queda desligado pero sobrevive (preserva el devengado
--    del EERR y la cuota en CxP si aplica).
--
--    Índice parcial: la gran mayoría de gastos NO viene de plantilla
--    (gastos manuales + gastos generados por OC), así que el índice
--    parcial WHERE NOT NULL ahorra espacio.
-- ============================================================================

ALTER TABLE gastos
  ADD COLUMN gasto_recurrente_id BIGINT
    REFERENCES gastos_recurrentes(id) ON DELETE SET NULL;

CREATE INDEX idx_gastos_recurrente_id
  ON gastos (gasto_recurrente_id) WHERE gasto_recurrente_id IS NOT NULL;

COMMENT ON COLUMN gastos.gasto_recurrente_id IS
  'FK opcional a la plantilla de gasto recurrente que originó este
   gasto (modelo "Cargar real" desde el panel /gastos tab Recurrentes).
   NULL en gastos manuales, gastos de OC (compras) y gastos previos
   a la migración 0046. Setear este FK NO afecta el EERR ni CxP — es
   metadata para el panel del mes y para histórico mes-a-mes futuro.';


-- ============================================================================
-- ─────────── FIN PARTE 1 ─ INICIO PARTE 2 (misma transacción) ───────────────
-- ============================================================================


-- ============================================================================
-- 4. fn_registrar_gasto v4 — DROP + CREATE con 11º param p_gasto_recurrente_id
-- ============================================================================
-- Cambios respecto a la 0045 (v3):
--
-- Param nuevo:
--   p_gasto_recurrente_id BIGINT DEFAULT NULL
--     Vínculo opcional a la plantilla de gasto recurrente que originó
--     este gasto. NULL en todos los flujos existentes (gastos manuales
--     desde NuevoGastoDialog sin plantilla, gastos via fn_recibir_oc,
--     etc.) — los callers actuales no se rompen. Solo el flujo
--     "Cargar real" desde el panel de Recurrentes lo pasa.
--
-- Validaciones nuevas (solo cuando p_gasto_recurrente_id IS NOT NULL):
--   - La plantilla existe Y pertenece al club del caller.
--   - categoria_id pasada como param coincide con la categoria_id
--     de la plantilla (defensa: el frontend pre-llena pero un usuario
--     podría cambiar la categoría en el dialog → la rompemos antes
--     de crear un gasto incoherente con su plantilla).
--   - NO se valida `activo=TRUE` — permitimos cargar un real atrasado
--     de una plantilla recién desactivada. El frontend ofrece
--     "Cargar real" solo para activos; esto es escape de DB.
--
-- TODO LO DEMÁS QUEDA IGUAL que la 0045:
--   - Gate de sesión + rol admin/vendedor.
--   - Validación monto > 0, fecha obligatoria, pago atómico,
--     medio_pago en enum.
--   - Resolución de categoría (con check de club + activa).
--   - Resolución de unidad.
--   - Resolución de proveedor (con check de club + activo, snapshot
--     del nombre).
--   - Regla de oro del efectivo (caja abierta si medio='efectivo').
--   - INSERT en gastos con TODOS los snapshots + nuevo gasto_recurrente_id.
--   - Generación de cuota automática si nace pendiente y no skip
--     (0045) — el nuevo param NO afecta esta lógica.
--
-- La signature cambia de 10 a 11 params → DROP + CREATE.
-- Callers existentes con 10 params siguen funcionando (el nuevo es
-- DEFAULT NULL).
-- ============================================================================
DROP FUNCTION IF EXISTS fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN
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

  -- ⭐ NUEVO 0046: si viene p_gasto_recurrente_id, validar la plantilla
  -- y exigir que su categoría coincida con p_categoria_id (defensa: el
  -- frontend pre-llena, pero un usuario podría cambiar la categoría
  -- en el dialog y romper la coherencia "este gasto pertenece a esta
  -- plantilla"). NO chequeamos activo=TRUE — permitimos cargar un
  -- real atrasado de una plantilla recién desactivada.
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

  -- INSERT con snapshots de categoría, unidad y proveedor + el FK a
  -- la plantilla recurrente (si vino).
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

  -- 0045: si el gasto nace PENDIENTE y el caller no pidió skip,
  -- generar una cuota total por defecto. Modelo uniforme para CxP:
  -- todo gasto pendiente tiene su deuda en gasto_cuotas.
  --
  -- p_skip_cuota_automatica=TRUE lo usa fn_recibir_oc cuando va a
  -- generar su propio plan (anticipo + N cuotas) — para no duplicar
  -- la cuota.
  --
  -- El nuevo p_gasto_recurrente_id NO afecta esta lógica: un gasto
  -- recurrente real pendiente genera su cuota igual que un gasto
  -- manual pendiente, y la cuota aparece en CxP automáticamente.
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
   Desde 0045: si el gasto nace pendiente (sin fecha_pago) y
   p_skip_cuota_automatica=FALSE, genera 1 cuota total en
   gasto_cuotas (modelo uniforme para CxP).
   Desde 0046: si viene p_gasto_recurrente_id, vincula el gasto a una
   plantilla de gasto recurrente — usado por el flujo "Cargar real"
   del panel /gastos tab Recurrentes. Valida que la plantilla exista
   en el club y que su categoría coincida. NO afecta el EERR (el
   vínculo es metadata para el panel del mes).
   Gate: admin O vendedor del club.';

GRANT EXECUTE ON FUNCTION fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN, BIGINT
) TO authenticated;


-- ============================================================================
-- FIN PARTE 2 ─ COMMIT de la transacción completa (PARTE 1 + PARTE 2)
-- ============================================================================

COMMIT;
