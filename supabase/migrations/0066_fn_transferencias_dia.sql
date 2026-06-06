-- ============================================================================
-- 0066_fn_transferencias_dia.sql
-- RPC de lectura para la reconciliación de transferencias: trae todos los
-- cobros con medio_pago='transferencia' de un rango de fechas, unificando las
-- tres fuentes de plata entrante (turnos, ventas de mostrador, cobros de clase).
--
-- =====================================================================
-- POR QUÉ UNA RPC (y no 3 queries en el cliente)
-- =====================================================================
-- - El filtro "día local AR" se expresa naturalmente en SQL con
--   AT TIME ZONE (mismo patrón canónico que fn_flujo_caja, 0061). En el
--   cliente habría que calcular a mano los instantes UTC de medianoche AR.
-- - El NOMBRE de quien pagó el turno se resuelve en SQL (2 LEFT JOIN:
--   jugadores por jugador_id, reserva_jugadores por reserva_jugador_id),
--   en vez de traer esas tablas aparte y mergear en memoria.
-- - Un solo round-trip + un único ORDER BY sobre el UNION ya ordenado.
--
-- =====================================================================
-- SEGURIDAD / RLS
-- =====================================================================
-- SECURITY INVOKER: corre con los permisos del que llama, así la RLS de las
-- cinco tablas referenciadas (reserva_pagos, ventas, clase_cobros, jugadores,
-- reserva_jugadores) filtra por club_id = current_club_id() automáticamente.
-- No se pasa club_id desde el cliente.
--
-- =====================================================================
-- SEMÁNTICA DE LAS FUENTES
-- =====================================================================
-- 1. reserva_pagos (origen 'turno'): excluye tipo='reembolso' (es plata que
--    SALE, no una transferencia entrante a conciliar). Nombre =
--    jugadores.nombre si hay jugador_id; sino reserva_jugadores.nombre_libre;
--    sino 'Invitado'. quien_transfirio = observaciones (el campo contextual
--    "¿Quién transfirió?" que escribe el vendedor al cobrar — Parte 2).
-- 2. ventas (origen 'venta'): nombre fijo 'Venta mostrador'. ventas NO tiene
--    columna observaciones → quien_transfirio = NULL.
-- 3. clase_cobros (origen 'clase'): nombre fijo 'Cobro de clase'.
--    quien_transfirio = NULL por decisión de producto (la columna existe pero
--    no se usa para esto por ahora).
--
-- Día local AR: límite inferior inclusivo, superior exclusivo (< hasta+1).
--
-- id compuesto ('origen:pk') → key única y estable para la tabla del frontend.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_transferencias_dia(
  p_desde DATE,
  p_hasta DATE
)
RETURNS TABLE (
  id               TEXT,        -- 'turno:123' | 'venta:45' | 'clase:9'
  fecha_hora       TIMESTAMPTZ,
  origen           TEXT,        -- 'turno' | 'venta' | 'clase'
  nombre           TEXT,
  quien_transfirio TEXT,        -- = observaciones (NULL en venta/clase)
  monto            NUMERIC,
  cuenta_id        BIGINT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (p_desde::timestamp       AT TIME ZONE 'America/Argentina/Buenos_Aires') AS desde_ts,
      ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') AS hasta_ts
  )
  -- 1. Turnos (reserva_pagos), excluye reembolsos
  SELECT
    'turno:' || rp.id::text,
    rp.fecha_hora,
    'turno'::text,
    COALESCE(j.nombre, rj.nombre_libre, 'Invitado'),
    rp.observaciones,
    rp.monto::numeric,
    rp.cuenta_id
  FROM reserva_pagos rp
  CROSS JOIN bounds b
  LEFT JOIN jugadores j          ON j.id  = rp.jugador_id
  LEFT JOIN reserva_jugadores rj ON rj.id = rp.reserva_jugador_id
  WHERE rp.medio_pago = 'transferencia'
    AND rp.tipo <> 'reembolso'
    AND rp.fecha_hora >= b.desde_ts
    AND rp.fecha_hora <  b.hasta_ts

  UNION ALL
  -- 2. Ventas de mostrador
  SELECT
    'venta:' || v.id::text,
    v.fecha_hora,
    'venta'::text,
    'Venta mostrador'::text,
    NULL::text,
    v.monto_total::numeric,
    v.cuenta_id
  FROM ventas v
  CROSS JOIN bounds b
  WHERE v.medio_pago = 'transferencia'
    AND v.fecha_hora >= b.desde_ts
    AND v.fecha_hora <  b.hasta_ts

  UNION ALL
  -- 3. Cobros de clase
  SELECT
    'clase:' || cc.id::text,
    cc.fecha_hora,
    'clase'::text,
    'Cobro de clase'::text,
    NULL::text,
    cc.monto::numeric,
    cc.cuenta_id
  FROM clase_cobros cc
  CROSS JOIN bounds b
  WHERE cc.medio_pago = 'transferencia'
    AND cc.fecha_hora >= b.desde_ts
    AND cc.fecha_hora <  b.hasta_ts

  ORDER BY fecha_hora DESC;
$$;

COMMENT ON FUNCTION fn_transferencias_dia(DATE, DATE) IS
  'Reconciliación de transferencias: UNION de cobros con medio_pago=transferencia
   de reserva_pagos (excluye reembolsos), ventas y clase_cobros, en un rango de
   fechas por día local AR (AT TIME ZONE America/Argentina/Buenos_Aires, límite
   superior exclusivo). Nombre del pagador resuelto por LEFT JOIN
   (jugadores / reserva_jugadores). quien_transfirio = observaciones (NULL en
   venta/clase). SECURITY INVOKER → RLS por club. Orden fecha_hora DESC.';

GRANT EXECUTE ON FUNCTION fn_transferencias_dia(DATE, DATE) TO authenticated;

COMMIT;

-- ============================================================================
-- Fin de la migración 0066_fn_transferencias_dia.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE (como usuario del club)
-- ============================================================================
-- A. Trae transferencias de hoy (ajustar fecha):
--    SELECT * FROM fn_transferencias_dia('2026-06-06', '2026-06-06');
--    → solo filas con medio_pago='transferencia' de TU club, orden fecha DESC.
--
-- B. Día local AR: un cobro hecho a las 23:30 hora AR del día X aparece bajo X
--    (no se corre al día siguiente por UTC).
--
-- C. Reembolso por transferencia NO aparece (tipo='reembolso' excluido).
--
-- D. Nombre: un turno cobrado a un jugador con ficha muestra su nombre; a un
--    invitado con nombre_libre muestra ese nombre; a un invitado sin nombre,
--    'Invitado'.
--
-- E. ventas → nombre 'Venta mostrador', quien_transfirio NULL.
--    clase_cobros → nombre 'Cobro de clase', quien_transfirio NULL.
-- ============================================================================
