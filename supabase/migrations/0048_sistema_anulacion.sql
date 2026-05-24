-- ============================================================================
-- 0048_sistema_anulacion.sql
-- Sistema de ANULACIÓN — Filosofía B (no se reescribe el pasado; las
-- correcciones de cajas cerradas se registran HOY con rastro).
--
-- ⚠️ ARCHIVO EN TRES PARTES. NO EJECUTAR HASTA QUE LAS PARTES 2 Y 3 ESTÉN
-- APPENDEADAS.
-- ─────────────────────────────────────────────────────────────────────────
--   PARTE 1 (este bloque): CREATE TABLE anulaciones (el cimiento: libro
--                          append-only del rastro) + RLS + GRANTs.
--   PARTE 2 (se agrega abajo): fn_anular_gasto (activo=FALSE + rastro;
--                          guardas: sin cuotas pagadas, sin OC; gate admin).
--   PARTE 3 (se agrega abajo): fn_anular_pago_cuota (nullea los 3 campos
--                          de la cuota; matriz de caja; gate según caja) +
--                          COMMIT de toda la transacción.
--   Las tres partes comparten UNA SOLA transacción (un único BEGIN acá, un
--   único COMMIT al final de la PARTE 3). Si la PARTE 2 o 3 falla, la tabla
--   tampoco se crea — el schema nunca queda a medias.
--
--   PARTE 4 (Caso 3, recurrentes uno-por-mes) va en una migración SEPARADA
--   (0049_gasto_recurrente_uno_por_mes.sql): toca otra función
--   (fn_registrar_gasto) y es otra preocupación.
-- ─────────────────────────────────────────────────────────────────────────
--
-- =====================================================================
-- CONCEPTO — DOS PIEZAS: estado vs rastro
-- =====================================================================
-- (A) ESTADO: el flag `activo` que YA existe en `gastos` y
--     `otros_ingresos`. Anular un gasto = activo=FALSE. El EERR
--     (useResumenFinanciero) ya filtra activo=TRUE, así que el gasto
--     anulado desaparece del resultado automáticamente. NO agregamos
--     columnas de auditoría (anulado_en/por/motivo) a cada tabla.
--
-- (B) RASTRO: esta tabla `anulaciones` — append-only, inmutable. Una
--     fila por evento de anulación, con FK tipada a lo anulado +
--     snapshot del estado original + quién/cuándo/por qué + link al
--     ajuste de caja de hoy (si lo hubo). Es el cimiento reusable: para
--     anular ventas/compras después, se suma su FK tipada + un valor al
--     enum entidad_tipo + su fn_anular_*.
--
-- =====================================================================
-- POR QUÉ fn_cerrar_caja (0047) NO SE TOCA
-- =====================================================================
-- Dos guardas hacen que el cierre de caja siga correcto sin columna ni
-- JOIN nuevo:
--   1. Anular un PAGO de cuota nullea gasto_cuotas.medio_pago → el
--      cálculo del esperado (que filtra medio_pago='efectivo') deja de
--      sumarla solo. (PARTE 3.)
--   2. fn_anular_gasto RECHAZA si el gasto tiene cuotas pagadas → un
--      gasto anulado solo tiene cuotas PENDIENTES, que no suman en caja
--      igual. (PARTE 2.)
-- Por eso no necesitamos activo en gasto_cuotas ni filtrar por el activo
-- del gasto madre en fn_cerrar_caja.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE 1 — TABLA: anulaciones (el libro de rastro)
-- ============================================================================
--    Append-only, inmutable (sin UPDATE/DELETE, igual que
--    caja_movimientos_manuales). Una fila = un evento de anulación.
--
--    FK TIPADAS NULLABLE + CHECK "exactamente uno": en vez de un
--    (entidad_tipo, entidad_id BIGINT) polimórfico, cada entidad anulable
--    tiene su propia FK con REFERENCES real (integridad referencial del
--    proyecto). El CHECK anulaciones_entidad_coherente garantiza que la
--    FK seteada coincide con entidad_tipo y que las demás están NULL.
--    Para sumar ventas/compras: +1 columna FK + 1 valor de enum + 1 rama
--    del CHECK, sin tocar lo existente.
--
--    SNAPSHOT de lo anulado (fecha_original, medio_pago_original,
--    caja_original_id, caja_original_cerrada, monto): Filosofía B — el
--    pasado queda registrado aunque la cuota se haya revertido a
--    pendiente (PARTE 3 nullea los campos de la cuota por el CHECK
--    atómico; el rastro del pago original vive ACÁ, no en la cuota).
--
--    caja_movimiento_id: link al ajuste_positivo registrado HOY en
--    caja_movimientos_manuales cuando se anula un pago en efectivo de una
--    caja YA CERRADA. NULL en los demás casos (no-efectivo, o caja del
--    pago todavía abierta, o anulación de gasto pendiente sin pago). La
--    regla "cuándo hay movimiento" la aplica la RPC (PARTE 3); la tabla
--    no la sobre-restringe para quedar como ledger genérico reusable.
-- ============================================================================
CREATE TABLE anulaciones (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  -- Discriminador de qué se anuló. Enum cerrado; se extiende por
  -- migración cuando se sumen ventas/compras/otros_ingresos.
  entidad_tipo VARCHAR(20) NOT NULL CHECK (entidad_tipo IN (
    'gasto',
    'pago_cuota'
    -- futuro: 'venta', 'compra', 'otro_ingreso'
  )),

  -- FK tipadas nullable. Exactamente UNA seteada, coherente con
  -- entidad_tipo (ver CHECK anulaciones_entidad_coherente). ON DELETE
  -- RESTRICT: gastos y gasto_cuotas no se borran físicamente (sin DELETE
  -- policy) — RESTRICT es coherente y bloquea cualquier borrado que
  -- dejara el rastro huérfano.
  gasto_id        BIGINT REFERENCES gastos(id)       ON DELETE RESTRICT,
  gasto_cuota_id  BIGINT REFERENCES gasto_cuotas(id) ON DELETE RESTRICT,
  -- futuro: venta_id, compra_id, otro_ingreso_id ...

  -- ── Motivo (categorizable + detalle libre) ──────────────────────────
  -- motivo_tipo: razón estructurada para reportes de anulaciones. Enum
  -- cerrado; se extiende por migración. motivo_detalle: texto libre
  -- opcional para el caso puntual (ej. "duplicado del recibo #123").
  motivo_tipo VARCHAR(30) NOT NULL CHECK (motivo_tipo IN (
    'error_monto',
    'error_carga_duplicado',
    'error_medio_pago',
    'devolucion_proveedor',
    'otro'
  )),
  motivo_detalle TEXT,

  -- ── Snapshot de lo anulado (rastro Filosofía B) ─────────────────────
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),  -- monto anulado
  fecha_original DATE,                              -- fecha_gasto / fecha_pago de la cuota
  medio_pago_original VARCHAR(20) CHECK (
    medio_pago_original IS NULL OR
    medio_pago_original IN ('efectivo','transferencia','mp','tarjeta','otro')
  ),
  caja_original_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT,  -- dónde entró/salió el efectivo
  caja_original_cerrada BOOLEAN,                    -- ¿la caja del pago ya estaba cerrada al anular?

  -- ── Impacto en la caja de HOY (ajuste compensatorio), si lo hubo ────
  caja_movimiento_id BIGINT REFERENCES caja_movimientos_manuales(id) ON DELETE RESTRICT,

  -- ── Quién / cuándo ──────────────────────────────────────────────────
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- CHECK "exactamente uno": la FK tipada seteada coincide con
  -- entidad_tipo y las demás quedan NULL. Cuando se sumen entidades,
  -- esta restricción crece con una rama por tipo.
  CONSTRAINT anulaciones_entidad_coherente CHECK (
    (entidad_tipo = 'gasto'
      AND gasto_id IS NOT NULL
      AND gasto_cuota_id IS NULL)
    OR
    (entidad_tipo = 'pago_cuota'
      AND gasto_cuota_id IS NOT NULL
      AND gasto_id IS NULL)
  )
);

-- ─── Índices ────────────────────────────────────────────────────────────
-- Lookup "¿este gasto / esta cuota fue anulado?" + mostrar el rastro.
CREATE INDEX idx_anulaciones_gasto
  ON anulaciones (gasto_id) WHERE gasto_id IS NOT NULL;
CREATE INDEX idx_anulaciones_gasto_cuota
  ON anulaciones (gasto_cuota_id) WHERE gasto_cuota_id IS NOT NULL;
-- Libro de anulaciones del club (listado cronológico DESC).
CREATE INDEX idx_anulaciones_club_fecha
  ON anulaciones (club_id, fecha_hora DESC);

COMMENT ON TABLE anulaciones IS
  'Libro append-only de anulaciones (Filosofía B). Una fila por evento:
   FK tipada a lo anulado (gasto / pago de cuota), motivo categorizable +
   detalle, snapshot del estado original (monto, fecha, medio, caja) y
   link al ajuste de caja de hoy si lo hubo. Inmutable (sin UPDATE/DELETE).
   Cimiento reusable: ventas/compras suman su FK tipada + valor de enum.';

COMMENT ON COLUMN anulaciones.caja_original_id IS
  'Caja donde había entrado/salido el efectivo del pago anulado. NULL si
   el pago no fue en efectivo o si se anula un gasto pendiente sin pago.';

COMMENT ON COLUMN anulaciones.caja_movimiento_id IS
  'Ajuste compensatorio (ajuste_positivo) registrado HOY en
   caja_movimientos_manuales cuando se anula un pago en efectivo de una
   caja YA CERRADA. NULL en el resto de los casos.';

COMMENT ON COLUMN anulaciones.motivo_tipo IS
  'Razón estructurada: error_monto, error_carga_duplicado,
   error_medio_pago, devolucion_proveedor, otro. Enum cerrado, se
   extiende por migración.';


-- ============================================================================
-- RLS y GRANTs — anulaciones
-- ============================================================================
-- SELECT: cualquier usuario activo del club ve el rastro (admin y
--   vendedor) — para mostrar "anulado" en las listas y el libro.
-- INSERT: admin O vendedor. Las RPCs (SECURITY INVOKER) hacen el INSERT;
--   esta policy es la barrera. El gate FINO por caso (admin-only para
--   anular gasto; admin o vendedor según caja para anular pago) vive en
--   el cuerpo de cada RPC — la policy permite la unión.
-- Sin UPDATE/DELETE → INMUTABLE (mismo patrón que caja_movimientos_manuales).
-- ============================================================================
ALTER TABLE anulaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anulaciones_select_propio_club"
ON anulaciones FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "anulaciones_insert_admin_o_vendedor"
ON anulaciones FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- Sin policies UPDATE/DELETE → fail-closed. El rastro no se edita ni se
-- borra (auditabilidad).

GRANT SELECT, INSERT ON anulaciones TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE anulaciones_id_seq TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⏸  FIN PARTE 1. La transacción sigue ABIERTA (se appendea PARTE 2 abajo).
-- ════════════════════════════════════════════════════════════════════════


-- ============================================================================
-- PARTE 2 — fn_anular_gasto
-- ============================================================================
-- Anula un gasto (soft-delete activo=FALSE) y registra el rastro en
-- `anulaciones`. Usado por el Caso 1 (corregir = anular + recrear) y por
-- "Corregir" en la tarjeta de recurrentes.
--
-- GATE: admin only (anular un gasto tiene peso contable — saca el monto
-- del EERR del período).
--
-- GUARDAS CRÍTICAS (las que mantienen fn_cerrar_caja intacta):
--   1. RECHAZA si alguna cuota del gasto está PAGADA (fecha_pago NOT NULL).
--      Un pago ya movió (o pudo mover) caja — eso es el Caso 2: primero
--      hay que anular el/los pagos con fn_anular_pago_cuota. Garantiza que
--      un gasto anulado SOLO tenga cuotas PENDIENTES (que no suman en caja).
--   2. RECHAZA si el gasto viene de una OC (existe compras.gasto_id =
--      gasto.id). Anularlo suelto dejaría la compra y el stock
--      inconsistentes — eso enruta a la futura anulación de compra.
--
-- NO TOCA CAJA: el gasto anulado por este flujo está pendiente y sus
-- cuotas no están pagadas (guarda 1) → nunca movió efectivo. El snapshot
-- en anulaciones va con medio_pago_original / caja_original_id /
-- caja_original_cerrada / caja_movimiento_id en NULL.
--
-- CONCURRENCIA: lock FOR UPDATE del gasto (serializa anular concurrentes
-- + re-chequea activo bajo el lock → no doble-anular) y de sus cuotas
-- (consistencia de la guarda 1 frente a un fn_pagar_cuota simultáneo —
-- ver nota de concurrencia residual al pie de esta migración).
--
-- ATÓMICA: UPDATE gastos + INSERT anulaciones en la misma transacción. Si
-- el INSERT falla (CHECK), el UPDATE se revierte.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_anular_gasto(
  p_gasto_id BIGINT,
  p_motivo_tipo VARCHAR,
  p_motivo_detalle TEXT DEFAULT NULL
)
RETURNS anulaciones
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_gasto gastos;
  v_motivo_detalle TEXT;
  v_anulacion anulaciones;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Gate: admin only (peso contable).
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular gastos.';
  END IF;

  -- Validar motivo_tipo (defensa; el CHECK de la tabla también lo valida).
  IF p_motivo_tipo IS NULL OR p_motivo_tipo NOT IN (
    'error_monto','error_carga_duplicado','error_medio_pago','devolucion_proveedor','otro'
  ) THEN
    RAISE EXCEPTION 'Motivo de anulación inválido.';
  END IF;

  -- Normalizar detalle: string vacío → NULL.
  v_motivo_detalle := NULLIF(TRIM(COALESCE(p_motivo_detalle, '')), '');

  -- Si el motivo es "otro", exigir detalle (un "otro" sin explicación no
  -- sirve para auditar).
  IF p_motivo_tipo = 'otro' AND v_motivo_detalle IS NULL THEN
    RAISE EXCEPTION 'Si el motivo es "otro", contá brevemente qué pasó en el detalle.';
  END IF;

  -- ── Lock + validación del gasto ───────────────────────────────────
  -- FOR UPDATE serializa anulaciones concurrentes del mismo gasto; el
  -- re-chequeo de activo bajo el lock evita doble-anular.
  SELECT * INTO v_gasto
  FROM gastos
  WHERE id = p_gasto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_gasto.activo THEN
    RAISE EXCEPTION 'Este gasto ya está anulado.';
  END IF;

  -- Lock de las cuotas del gasto: consistencia de la guarda 1 frente a un
  -- fn_pagar_cuota concurrente (que lockea la fila de la cuota FOR UPDATE).
  PERFORM 1 FROM gasto_cuotas
  WHERE gasto_id = p_gasto_id AND club_id = v_club_id
  FOR UPDATE;

  -- ── GUARDA 1: sin cuotas pagadas ──────────────────────────────────
  -- Si hay un pago, eso es el Caso 2: anular primero el pago. Esta guarda
  -- garantiza que un gasto anulado solo tenga cuotas pendientes → no suma
  -- en fn_cerrar_caja (que la deja intacta).
  IF EXISTS (
    SELECT 1 FROM gasto_cuotas
    WHERE gasto_id = p_gasto_id AND fecha_pago IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Este gasto tiene cuotas pagadas. Anulá primero el/los pagos (desde Cuentas por Pagar) y después el gasto.';
  END IF;

  -- ── GUARDA 2: no viene de una OC ──────────────────────────────────
  -- compras.gasto_id se setea al recibir la OC (fn_recibir_oc). Anular el
  -- gasto suelto dejaría compra + stock inconsistentes.
  IF EXISTS (
    SELECT 1 FROM compras
    WHERE gasto_id = p_gasto_id AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION
      'Este gasto proviene de una orden de compra. Para corregirlo, anulá la compra (acción no disponible todavía).';
  END IF;

  -- ── Soft-delete ───────────────────────────────────────────────────
  UPDATE gastos SET activo = FALSE WHERE id = p_gasto_id;

  -- ── Rastro (sin impacto de caja: gasto pendiente, sin pagos) ──────
  INSERT INTO anulaciones (
    club_id, entidad_tipo, gasto_id, gasto_cuota_id,
    motivo_tipo, motivo_detalle,
    monto, fecha_original, medio_pago_original,
    caja_original_id, caja_original_cerrada, caja_movimiento_id,
    usuario_id
  ) VALUES (
    v_club_id, 'gasto', p_gasto_id, NULL,
    p_motivo_tipo, v_motivo_detalle,
    v_gasto.monto, v_gasto.fecha_gasto, NULL,
    NULL, NULL, NULL,
    v_usuario_id
  )
  RETURNING * INTO v_anulacion;

  RETURN v_anulacion;
END;
$$;

COMMENT ON FUNCTION fn_anular_gasto(BIGINT, VARCHAR, TEXT) IS
  'Anula un gasto (activo=FALSE) y registra el rastro en anulaciones
   (entidad_tipo=gasto, snapshot de monto/fecha). Caso 1 del sistema de
   anulación (corregir = anular + recrear). Gate: admin. Guardas: rechaza
   si el gasto tiene cuotas pagadas (eso es Caso 2: anular primero el pago)
   y si viene de una OC (enruta a anulación de compra). NO toca caja (el
   gasto pendiente sin pagos nunca movió efectivo). Atómica.';

GRANT EXECUTE ON FUNCTION fn_anular_gasto(BIGINT, VARCHAR, TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⏸  FIN PARTE 2. La transacción sigue ABIERTA (se appendean PARTE 3,
--     PARTE 3b y el COMMIT abajo).
-- ════════════════════════════════════════════════════════════════════════


-- ============================================================================
-- PARTE 3 — fn_anular_pago_cuota (Filosofía B)
-- ============================================================================
-- Anula el PAGO de una cuota (la deuda vuelve a pendiente). El gasto
-- madre NO se toca → el EERR NO se toca (la cuota es flujo de caja, no
-- devengado).
--
-- NULLEA LOS 3 CAMPOS DE LA CUOTA (fecha_pago, medio_pago, turno_caja_id):
-- no es estético — lo IMPONE el CHECK cuota_pago_atomico (0045), que
-- exige los tres NULL juntos o los tres con valor. El rastro del pago
-- original (medio, caja, fecha) se preserva en `anulaciones`, no en la
-- cuota.
--
-- MATRIZ DE CAJA (según medio del pago y estado de SU caja):
--   1. NO efectivo (transf/mp/tarjeta/otro): NINGUNA acción de caja —
--      el pago nunca tocó un arqueo (turno_caja_id era NULL).
--   2. Efectivo, caja del pago ABIERTA: NINGUNA acción — al nullear
--      medio_pago, fn_cerrar_caja (0047) deja de sumarla en el cierre
--      futuro de esa misma caja. El efectivo "vuelve" al cajón antes del
--      cierre. Nada firme todavía.
--   3. Efectivo, caja del pago CERRADA (firme): NO se reescribe el
--      cierre. Se registra HOY un ajuste_positivo en
--      caja_movimientos_manuales (el efectivo que "salió" de una caja
--      cerrada reaparece como sobrante de hoy), que fn_cerrar_caja YA
--      cuenta (Fuente B). Requiere caja abierta hoy → si no hay, RAISE.
--
-- RASTRO: anulaciones con entidad_tipo='pago_cuota', snapshot del pago
-- original (monto, fecha_pago, medio, caja, si la caja estaba cerrada) y
-- link al ajuste de caja de hoy (caja_movimiento_id) cuando aplica.
--
-- GATE SEGÚN CASO:
--   - Caso 1 y 2 (no-efectivo, o efectivo con caja abierta): admin O
--     vendedor (fix operativo del turno, sin tocar nada firme).
--   - Caso 3 (efectivo + caja cerrada → genera ajuste): admin only
--     (peso contable: corrige una caja ya cerrada).
--
-- ATÓMICA: (ajuste de caja si aplica) + nulleo de la cuota + rastro, todo
-- en la misma transacción.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_anular_pago_cuota(
  p_cuota_id BIGINT,
  p_motivo_tipo VARCHAR,
  p_motivo_detalle TEXT DEFAULT NULL
)
RETURNS anulaciones
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_rol VARCHAR;
  v_cuota gasto_cuotas;
  v_motivo_detalle TEXT;
  v_es_efectivo BOOLEAN;
  v_caja_cerrada_en TIMESTAMPTZ;
  v_caja_original_cerrada BOOLEAN;  -- NULL si el pago no fue en efectivo
  v_caja_hoy BIGINT;
  v_mov_id BIGINT := NULL;
  v_concepto VARCHAR;
  v_anulacion anulaciones;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Gate base: como mínimo admin O vendedor (el gate fino del Caso 3
  -- viene después, una vez que sabemos el estado de la caja del pago).
  v_rol := current_user_rol();
  IF v_rol NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para anular pagos.';
  END IF;

  -- Validar motivo_tipo (defensa; el CHECK de la tabla también lo valida).
  IF p_motivo_tipo IS NULL OR p_motivo_tipo NOT IN (
    'error_monto','error_carga_duplicado','error_medio_pago','devolucion_proveedor','otro'
  ) THEN
    RAISE EXCEPTION 'Motivo de anulación inválido.';
  END IF;

  -- Normalizar detalle: string vacío → NULL. "otro" exige detalle.
  v_motivo_detalle := NULLIF(TRIM(COALESCE(p_motivo_detalle, '')), '');
  IF p_motivo_tipo = 'otro' AND v_motivo_detalle IS NULL THEN
    RAISE EXCEPTION 'Si el motivo es "otro", contá brevemente qué pasó en el detalle.';
  END IF;

  -- ── Lock + validación de la cuota ─────────────────────────────────
  -- FOR UPDATE serializa contra otra anulación del mismo pago y contra
  -- fn_pagar_cuota (que lockea la misma fila).
  SELECT * INTO v_cuota
  FROM gasto_cuotas
  WHERE id = p_cuota_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuota no existe o no pertenece a tu club.';
  END IF;
  IF v_cuota.fecha_pago IS NULL THEN
    RAISE EXCEPTION 'Esta cuota no está pagada — no hay pago para anular.';
  END IF;

  -- ── Determinar el escenario de caja ───────────────────────────────
  -- Si fue efectivo, la cuota tiene turno_caja_id NOT NULL garantizado
  -- por el CHECK cuota_efectivo_requiere_caja (0045). Miramos si esa
  -- caja ya cerró.
  v_es_efectivo := (v_cuota.medio_pago = 'efectivo');

  IF v_es_efectivo THEN
    SELECT cerrada_en INTO v_caja_cerrada_en
    FROM turnos_caja
    WHERE id = v_cuota.turno_caja_id AND club_id = v_club_id;
    v_caja_original_cerrada := (v_caja_cerrada_en IS NOT NULL);
  ELSE
    v_caja_original_cerrada := NULL;  -- no hubo caja (no-efectivo)
  END IF;

  -- ── Gate fino del Caso 3 (efectivo + caja cerrada → ajuste) ───────
  IF v_es_efectivo AND v_caja_original_cerrada AND v_rol <> 'admin' THEN
    RAISE EXCEPTION
      'Anular un pago en efectivo de una caja ya cerrada requiere administrador (genera un ajuste en la caja de hoy).';
  END IF;

  -- ── CASO 3: ajuste_positivo en la caja de HOY ─────────────────────
  -- Solo efectivo + caja del pago cerrada. El efectivo que salió de una
  -- caja firme reaparece hoy como sobrante. Requiere caja abierta hoy.
  IF v_es_efectivo AND v_caja_original_cerrada THEN
    v_caja_hoy := current_club_caja_abierta();
    IF v_caja_hoy IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta para registrar el ajuste de esta anulación. Abrí la caja del día e intentá de nuevo.';
    END IF;

    v_concepto := 'Anulación pago cuota #' || v_cuota.numero
                || ' gasto #' || v_cuota.gasto_id
                || ' (pago del ' || v_cuota.fecha_pago::TEXT || ')';

    INSERT INTO caja_movimientos_manuales (
      club_id, turno_caja_id, tipo, monto, concepto, observaciones, usuario_id
    ) VALUES (
      v_club_id, v_caja_hoy, 'ajuste_positivo', v_cuota.monto, v_concepto,
      v_motivo_detalle, v_usuario_id
    )
    RETURNING id INTO v_mov_id;
  END IF;
  -- Casos 1 (no-efectivo) y 2 (efectivo + caja abierta): no se toca caja.

  -- ── Revertir la cuota a PENDIENTE ─────────────────────────────────
  -- Los 3 campos a NULL juntos (lo exige el CHECK cuota_pago_atomico).
  -- El gasto madre NO se toca → EERR intacto.
  UPDATE gasto_cuotas
  SET fecha_pago = NULL,
      medio_pago = NULL,
      turno_caja_id = NULL
  WHERE id = p_cuota_id;

  -- ── Rastro (snapshot del pago original, tomado ANTES del nulleo) ──
  INSERT INTO anulaciones (
    club_id, entidad_tipo, gasto_id, gasto_cuota_id,
    motivo_tipo, motivo_detalle,
    monto, fecha_original, medio_pago_original,
    caja_original_id, caja_original_cerrada, caja_movimiento_id,
    usuario_id
  ) VALUES (
    v_club_id, 'pago_cuota', NULL, p_cuota_id,
    p_motivo_tipo, v_motivo_detalle,
    v_cuota.monto, v_cuota.fecha_pago, v_cuota.medio_pago,
    v_cuota.turno_caja_id, v_caja_original_cerrada, v_mov_id,
    v_usuario_id
  )
  RETURNING * INTO v_anulacion;

  RETURN v_anulacion;
END;
$$;

COMMENT ON FUNCTION fn_anular_pago_cuota(BIGINT, VARCHAR, TEXT) IS
  'Anula el pago de una cuota (vuelve a pendiente) sin tocar el gasto
   madre (EERR intacto). Nullea los 3 campos de pago de la cuota (lo
   exige el CHECK cuota_pago_atomico). Caja (Filosofía B): nada si el
   pago no fue efectivo o si su caja sigue abierta; ajuste_positivo en
   caja_movimientos_manuales de hoy si fue efectivo y su caja ya cerró
   (requiere caja abierta hoy). Rastro completo en anulaciones. Gate:
   admin O vendedor; admin only cuando genera ajuste (caja cerrada).
   Atómica.';

GRANT EXECUTE ON FUNCTION fn_anular_pago_cuota(BIGINT, VARCHAR, TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⏸  FIN PARTE 3. La transacción sigue ABIERTA (se appendea PARTE 3b +
--     COMMIT abajo).
-- ════════════════════════════════════════════════════════════════════════


-- ============================================================================
-- PARTE 3b — fn_pagar_cuota (CREATE OR REPLACE; +guarda gasto activo)
-- ============================================================================
-- Versión vigente: 0045. Esta es IDÉNTICA a la 0045 salvo UN agregado:
--
--   ⭐ GUARDA NUEVA 0048: rechazar pagar una cuota cuyo gasto madre esté
--      anulado (gastos.activo = FALSE). Es la guarda SIMÉTRICA de
--      fn_anular_gasto (que rechaza anular gastos con cuotas pagadas).
--      Juntas cierran la concurrencia "anular gasto + pagar cuota" y
--      garantizan que NUNCA quede una cuota en efectivo pagada bajo un
--      gasto anulado → fn_cerrar_caja (0047) sigue intacta sin filtrar
--      por el activo del gasto madre.
--
-- Race-safety: fn_anular_gasto lockea TODAS las cuotas del gasto
-- (PERFORM ... FOR UPDATE) antes de setear activo=FALSE. Acá tomamos el
-- lock de la cuota (SELECT ... FOR UPDATE) y RECIÉN DESPUÉS leemos
-- gastos.activo. Si la anulación corrió primero, esperó hasta soltar el
-- lock de la cuota al commit, y para cuando lo obtenemos el SELECT
-- (READ COMMITTED) ya ve activo=FALSE → rechazamos. Si el pago corre
-- primero, la anulación verá la cuota pagada y será ella la que rechace.
--
-- Resto IDÉNTICO a 0045: FOR UPDATE anti-doble-pago + re-chequeo de
-- fecha_pago bajo el lock, regla de oro del efectivo (caja abierta si
-- medio='efectivo', captura turno_caja_id), gate admin/vendedor, NO toca
-- gastos.fecha_pago (el estado de la deuda se deriva on-the-fly).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_pagar_cuota(
  p_cuota_id BIGINT,
  p_fecha_pago DATE,
  p_medio_pago VARCHAR
)
RETURNS gasto_cuotas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cuota gasto_cuotas;
  v_gasto_activo BOOLEAN;            -- ⭐ NUEVO 0048
  v_turno_caja_id BIGINT := NULL;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para pagar cuotas.';
  END IF;

  -- Validaciones de input.
  IF p_fecha_pago IS NULL THEN
    RAISE EXCEPTION 'La fecha de pago es obligatoria.';
  END IF;
  IF p_medio_pago IS NULL
     OR p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ── Lock exclusivo de la cuota + validación bajo el lock ──────────
  -- SELECT FOR UPDATE serializa pagos concurrentes a la misma cuota.
  -- Si la cuota no existe o no pertenece al club, RAISE. Si ya fue
  -- pagada (chequeo BAJO el lock — protege contra race entre dos
  -- llamadas simultáneas), RAISE accionable.
  SELECT * INTO v_cuota
  FROM gasto_cuotas
  WHERE id = p_cuota_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuota no existe o no pertenece a tu club.';
  END IF;
  IF v_cuota.fecha_pago IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta cuota ya está pagada (% por %).',
      v_cuota.fecha_pago, v_cuota.medio_pago;
  END IF;

  -- ── ⭐ GUARDA NUEVA 0048: gasto madre no anulado ──────────────────
  -- Simétrica a fn_anular_gasto. Leemos gastos.activo DESPUÉS de tomar
  -- el lock de la cuota (ver nota de race-safety en el header). El gasto
  -- siempre existe (FK gasto_cuotas.gasto_id RESTRICT).
  SELECT activo INTO v_gasto_activo
  FROM gastos
  WHERE id = v_cuota.gasto_id;

  IF NOT v_gasto_activo THEN
    RAISE EXCEPTION 'No se puede pagar la cuota de un gasto anulado.';
  END IF;

  -- ── Regla de oro del efectivo ─────────────────────────────────────
  -- Si pago en efectivo, atar a la caja abierta. Falla rápido antes
  -- del UPDATE.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de pagar en efectivo.';
    END IF;
  END IF;

  -- ── Marcar como pagada ────────────────────────────────────────────
  -- NO se toca gastos.fecha_pago. El estado del gasto (pendiente /
  -- parcial / saldado) se deriva on-the-fly de la suma de cuotas.
  UPDATE gasto_cuotas
  SET fecha_pago = p_fecha_pago,
      medio_pago = p_medio_pago,
      turno_caja_id = v_turno_caja_id
  WHERE id = p_cuota_id
  RETURNING * INTO v_cuota;

  RETURN v_cuota;
END;
$$;

COMMENT ON FUNCTION fn_pagar_cuota(BIGINT, DATE, VARCHAR) IS
  'Marca una cuota pendiente como pagada. Toma lock FOR UPDATE sobre
   la fila para prevenir doble-pago concurrente (re-chequea fecha_pago
   bajo el lock). Desde 0048: rechaza pagar la cuota si el gasto madre
   está anulado (activo=FALSE) — guarda simétrica de fn_anular_gasto que
   mantiene fn_cerrar_caja intacta. Si medio_pago=efectivo, aplica regla
   de oro: valida caja abierta y captura turno_caja_id. NO toca
   gastos.fecha_pago — el estado de la deuda madre se deriva on-the-fly
   de la suma de cuotas. Gate: admin O vendedor del club.';

GRANT EXECUTE ON FUNCTION fn_pagar_cuota(BIGINT, DATE, VARCHAR) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ✅  COMMIT — cierra la transacción completa (PARTES 1 + 2 + 3 + 3b).
-- ════════════════════════════════════════════════════════════════════════
COMMIT;

-- ============================================================================
-- Fin de la migración 0048_sistema_anulacion.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Tabla + CHECK + RLS ----------
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'anulaciones'::regclass AND contype = 'c';
-- → incluye anulaciones_entidad_coherente (gasto / pago_cuota), el CHECK
--   de motivo_tipo, el de medio_pago_original y monto > 0.
-- SELECT polname, cmd FROM pg_policies WHERE tablename = 'anulaciones';
-- → select_propio_club (SELECT), insert_admin_o_vendedor (INSERT). Sin UPDATE/DELETE.

-- ---------- B. fn_anular_gasto — guarda "sin cuotas pagadas" ----------
-- Gasto con su cuota pagada → anular debe rechazar:
--   await window.supabase.rpc('fn_anular_gasto', {
--     p_gasto_id: <gasto con cuota pagada>, p_motivo_tipo: 'error_monto'
--   });
-- → 'Este gasto tiene cuotas pagadas. Anulá primero el/los pagos ...'

-- ---------- C. fn_anular_gasto — guarda "sin OC" ----------
-- Gasto generado por fn_recibir_oc:
--   await window.supabase.rpc('fn_anular_gasto', { p_gasto_id: <gasto de OC>, p_motivo_tipo: 'otro', p_motivo_detalle: 'x' });
-- → 'Este gasto proviene de una orden de compra...'

-- ---------- D. fn_anular_gasto — feliz (Caso 1) ----------
-- Gasto pendiente manual, cuota sin pagar:
--   await window.supabase.rpc('fn_anular_gasto', {
--     p_gasto_id: <X>, p_motivo_tipo: 'error_monto', p_motivo_detalle: 'eran 120000'
--   });
-- → gastos.activo=FALSE; fila en anulaciones (entidad_tipo='gasto',
--   monto, fecha_original=fecha_gasto, caja_* NULL).
-- → El gasto desaparece del EERR (filtra activo=TRUE). Recrear con el
--   monto correcto vía fn_registrar_gasto.

-- ---------- E. fn_anular_pago_cuota — efectivo, caja ABIERTA ----------
-- Pagar una cuota en efectivo (caja abierta), luego anular el pago SIN
-- cerrar la caja:
--   await window.supabase.rpc('fn_anular_pago_cuota', {
--     p_cuota_id: <X>, p_motivo_tipo: 'error_medio_pago'
--   });
-- → cuota: fecha_pago/medio_pago/turno_caja_id = NULL (vuelve a CxP).
-- → anulaciones: caja_original_cerrada=FALSE, caja_movimiento_id=NULL.
-- → SIN movimiento en caja_movimientos_manuales. Al cerrar esa caja, el
--   esperado NO incluye la cuota (medio nulleado). diferencia=0.

-- ---------- F. fn_anular_pago_cuota — efectivo, caja CERRADA ----------
-- Pagar cuota efectivo, CERRAR la caja, abrir una nueva, anular el pago:
--   await window.supabase.rpc('fn_anular_pago_cuota', {
--     p_cuota_id: <X>, p_motivo_tipo: 'error_carga_duplicado'
--   });
-- → caja_movimientos_manuales: fila 'ajuste_positivo' por el monto en la
--   caja de hoy. anulaciones: caja_original_cerrada=TRUE,
--   caja_movimiento_id=<id>. La caja cerrada NO se modifica.

-- ---------- G. fn_anular_pago_cuota — efectivo+cerrada sin caja hoy ----
-- Mismo escenario que F pero SIN caja abierta hoy:
-- → 'No hay caja abierta para registrar el ajuste de esta anulación...'
-- → ROLLBACK: la cuota sigue pagada, sin movimiento.

-- ---------- H. fn_anular_pago_cuota — no-efectivo ----------
-- Pagar cuota por transferencia, anular:
-- → cuota a pendiente; anulaciones con caja_original_id=NULL,
--   caja_original_cerrada=NULL, caja_movimiento_id=NULL. Sin caja.

-- ---------- I. fn_pagar_cuota — guarda gasto anulado ----------
-- Anular un gasto pendiente (Caso 1, feliz) y luego intentar pagar su cuota:
--   await window.supabase.rpc('fn_pagar_cuota', {
--     p_cuota_id: <cuota del gasto anulado>, p_fecha_pago: '2026-05-24', p_medio_pago: 'efectivo'
--   });
-- → 'No se puede pagar la cuota de un gasto anulado.'

-- ---------- J. Gate de roles ----------
-- Como vendedor: fn_anular_gasto → 'Solo el administrador puede anular gastos.'
-- Como vendedor: fn_anular_pago_cuota de un pago efectivo de caja CERRADA
--   → 'Anular un pago en efectivo de una caja ya cerrada requiere administrador...'
-- Como vendedor: fn_anular_pago_cuota de un pago no-efectivo o de caja abierta → OK.
-- ============================================================================
