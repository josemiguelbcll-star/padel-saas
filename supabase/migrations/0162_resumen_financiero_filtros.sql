-- ============================================================================
-- 0162_resumen_financiero_filtros.sql
-- Amplía fn_obtener_resumen_financiero para permitir filtrado por rango
-- personalizado de fechas (p_desde, p_hasta) y por medio de pago (p_medio_pago).
-- Mantiene total retrocompatibilidad con llamadas posicionales (p_anio, p_mes).
-- ============================================================================

-- Eliminar firmas anteriores sobrecargadas para evitar conflicto PGRST203 en PostgREST
DROP FUNCTION IF EXISTS public.fn_obtener_resumen_financiero(integer, integer);
DROP FUNCTION IF EXISTS public.fn_obtener_resumen_financiero(integer, integer, date, date, varchar);

CREATE OR REPLACE FUNCTION public.fn_obtener_resumen_financiero(
  p_anio integer DEFAULT NULL,
  p_mes integer DEFAULT NULL,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL,
  p_medio_pago varchar DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_club_id bigint;
  v_usuario_id uuid;
  v_desde date;
  v_hasta date;
  v_desde_iso timestamp;
  v_hasta_iso timestamp;
  v_ingreso_canchas numeric := 0;
  v_ingreso_clases numeric := 0;
  v_ventas_buffet_ingreso numeric := 0;
  v_ventas_shop_ingreso numeric := 0;
  v_consumos_buffet_ingreso numeric := 0;
  v_consumos_shop_ingreso numeric := 0;
  v_ingreso_buffet numeric := 0;
  v_ingreso_shop numeric := 0;
  v_ventas_buffet_costo numeric := 0;
  v_ventas_shop_costo numeric := 0;
  v_consumos_buffet_costo numeric := 0;
  v_consumos_shop_costo numeric := 0;
  v_costo_buffet numeric := 0;
  v_costo_shop numeric := 0;
  v_costos_directos numeric := 0;
  v_ingresos_total numeric := 0;
  v_gastos_operativos numeric := 0;
  v_gastos_estructura numeric := 0;
  v_gastos_financieros numeric := 0;
  v_gastos_otros numeric := 0;
  v_compras_mercaderia numeric := 0;
  v_gastos_total numeric := 0;
  v_financial_income numeric := 0;
  v_net_financial_result numeric := 0;
  v_resultado_neto numeric := 0;
  v_margen_bruto numeric := 0;
  v_resultado_operativo numeric := 0;
  v_margen_porcentaje numeric := 0;
  v_json_ingresos_por_unidad json;
  v_json_costos_por_linea json;
  v_json_top_gastos json;
  v_json_movimientos json;
  v_json_ingresos_diarios json;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Resolver rango de fechas
  IF p_desde IS NOT NULL AND p_hasta IS NOT NULL THEN
    v_desde := p_desde;
    v_hasta := p_hasta;
  ELSIF p_anio IS NOT NULL AND p_mes IS NOT NULL THEN
    v_desde := (p_anio || '-' || LPAD(p_mes::text, 2, '0') || '-01')::date;
    v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  ELSE
    v_desde := (EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || LPAD(EXTRACT(MONTH FROM CURRENT_DATE)::text, 2, '0') || '-01')::date;
    v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  END IF;

  v_desde_iso := (v_desde::text || ' 00:00:00')::timestamp;
  v_hasta_iso := (v_hasta::text || ' 23:59:59')::timestamp;

  -- 1. Ingresos por alquiler de canchas
  SELECT COALESCE(SUM(CASE WHEN tipo = 'reembolso' THEN -monto_alquiler ELSE monto_alquiler END), 0)
  INTO v_ingreso_canchas
  FROM reserva_pagos
  WHERE club_id = v_club_id 
    AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
    AND (
      p_medio_pago IS NULL 
      OR medio_pago = p_medio_pago 
      OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
      OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
    );

  -- 2. Ingresos por clases / escuela
  SELECT COALESCE(SUM(monto), 0)
  INTO v_ingreso_clases
  FROM clase_cobros
  WHERE club_id = v_club_id 
    AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
    AND (
      p_medio_pago IS NULL 
      OR medio_pago = p_medio_pago 
      OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
      OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
    );

  -- 3. Ventas de mostrador (buffet y shop)
  SELECT
    COALESCE(SUM(CASE WHEN vi.linea = 'buffet' THEN vi.precio_unitario * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'shop' THEN vi.precio_unitario * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'buffet' THEN COALESCE(vi.costo_unitario, 0) * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'shop' THEN COALESCE(vi.costo_unitario, 0) * vi.cantidad ELSE 0 END), 0)
  INTO v_ventas_buffet_ingreso, v_ventas_shop_ingreso, v_ventas_buffet_costo, v_ventas_shop_costo
  FROM venta_items vi
  JOIN ventas v ON vi.venta_id = v.id
  WHERE v.club_id = v_club_id AND v.activa = TRUE
    AND v.fecha_hora >= v_desde_iso AND v.fecha_hora <= v_hasta_iso
    AND (
      p_medio_pago IS NULL
      OR EXISTS (
        SELECT 1 FROM venta_pagos vp 
        WHERE vp.venta_id = v.id 
          AND (
            vp.medio_pago = p_medio_pago 
            OR (p_medio_pago IN ('mp', 'mercado_pago') AND vp.medio_pago IN ('mp', 'mercado_pago'))
            OR (p_medio_pago = 'tarjeta' AND vp.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
          )
      )
      OR (
        v.medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND v.medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND v.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
    );

  -- 4. Consumos de turnos cobrados
  WITH candidatos AS (
    SELECT DISTINCT rp.reserva_id
    FROM reserva_pagos rp
    WHERE rp.club_id = v_club_id AND rp.monto_consumo > 0
      AND rp.fecha_hora >= v_desde_iso AND rp.fecha_hora <= v_hasta_iso
      AND (
        p_medio_pago IS NULL 
        OR rp.medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND rp.medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND rp.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
  ),
  ya_contados AS (
    SELECT DISTINCT rp.reserva_id
    FROM reserva_pagos rp
    WHERE rp.club_id = v_club_id AND rp.monto_consumo > 0
      AND rp.fecha_hora < v_desde_iso
      AND rp.reserva_id IN (SELECT reserva_id FROM candidatos)
  ),
  candidatos_filtrados AS (
    SELECT c.reserva_id
    FROM candidatos c
    WHERE c.reserva_id NOT IN (SELECT reserva_id FROM ya_contados)
  )
  SELECT
    COALESCE(SUM(CASE WHEN rc.linea = 'buffet' THEN rc.subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN rc.linea = 'shop' THEN rc.subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN rc.linea = 'buffet' THEN COALESCE(rc.costo_unitario, 0) * rc.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN rc.linea = 'shop' THEN COALESCE(rc.costo_unitario, 0) * rc.cantidad ELSE 0 END), 0)
  INTO v_consumos_buffet_ingreso, v_consumos_shop_ingreso,
       v_consumos_buffet_costo, v_consumos_shop_costo
  FROM reserva_consumos rc
  WHERE rc.club_id = v_club_id
    AND rc.reserva_id IN (SELECT reserva_id FROM candidatos_filtrados);

  v_ingreso_buffet := v_ventas_buffet_ingreso + v_consumos_buffet_ingreso;
  v_ingreso_shop := v_ventas_shop_ingreso + v_consumos_shop_ingreso;
  v_costo_buffet := v_ventas_buffet_costo + v_consumos_buffet_costo;
  v_costo_shop := v_ventas_shop_costo + v_consumos_shop_costo;
  v_costos_directos := v_costo_buffet + v_costo_shop;

  -- 5. Otros ingresos (auspicios, membresías, etc.)
  WITH otros_agrupados AS (
    SELECT unidad_nombre AS unidad, unidad_tipo AS tipo, SUM(monto) AS monto
    FROM otros_ingresos
    WHERE club_id = v_club_id AND activo = true AND unidad_tipo <> 'financiero'
      AND fecha >= v_desde AND fecha <= v_hasta
      AND (
        p_medio_pago IS NULL 
        OR medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
    GROUP BY unidad_nombre, unidad_tipo
  ),
  unidades_unidas AS (
    SELECT 'Canchas' AS unidad, 'canchas' AS tipo, v_ingreso_canchas AS monto WHERE v_ingreso_canchas > 0
    UNION ALL SELECT 'Escuela', 'clases', v_ingreso_clases WHERE v_ingreso_clases > 0
    UNION ALL SELECT 'Buffet', 'buffet', v_ingreso_buffet WHERE v_ingreso_buffet > 0
    UNION ALL SELECT 'Shop', 'shop', v_ingreso_shop WHERE v_ingreso_shop > 0
    UNION ALL SELECT unidad, tipo, monto FROM otros_agrupados WHERE monto > 0
  ),
  unidades_agrupadas AS (
    SELECT unidad, tipo, SUM(monto) AS monto
    FROM unidades_unidas
    GROUP BY unidad, tipo
  )
  SELECT COALESCE(
    json_agg(json_build_object('unidad', unidad, 'tipo', tipo, 'monto', monto) ORDER BY monto DESC),
    '[]'::json
  )
  INTO v_json_ingresos_por_unidad
  FROM unidades_agrupadas;

  v_ingresos_total := v_ingreso_canchas + v_ingreso_clases + v_ingreso_buffet + v_ingreso_shop
    + COALESCE((
      SELECT SUM(monto) FROM otros_ingresos
      WHERE club_id = v_club_id AND activo = true AND unidad_tipo <> 'financiero'
        AND fecha >= v_desde AND fecha <= v_hasta
        AND (
          p_medio_pago IS NULL 
          OR medio_pago = p_medio_pago 
          OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
          OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
        )
    ), 0);

  WITH lineas_todas AS (
    SELECT 'buffet' AS linea, v_costo_buffet AS monto WHERE v_costo_buffet > 0
    UNION ALL SELECT 'shop', v_costo_shop WHERE v_costo_shop > 0
  )
  SELECT COALESCE(
    json_agg(json_build_object('linea', linea, 'monto', monto) ORDER BY monto DESC),
    '[]'::json
  )
  INTO v_json_costos_por_linea
  FROM lineas_todas;

  -- 6. Gastos según clasificación
  SELECT
    COALESCE(SUM(CASE WHEN g.clasificacion = 'DIRECT_OTHER' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'STRUCTURE' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'FINANCIAL' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion NOT IN ('DIRECT_MERCHANDISE', 'DIRECT_OTHER', 'STRUCTURE', 'FINANCIAL') THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'DIRECT_MERCHANDISE' THEN g.monto ELSE 0 END), 0)
  INTO v_gastos_operativos, v_gastos_estructura, v_gastos_financieros,
       v_gastos_otros, v_compras_mercaderia
  FROM gastos g
  WHERE g.club_id = v_club_id AND g.activo = true
    AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta
    AND (
      p_medio_pago IS NULL 
      OR g.medio_pago = p_medio_pago 
      OR (p_medio_pago IN ('mp', 'mercado_pago') AND g.medio_pago IN ('mp', 'mercado_pago'))
      OR (p_medio_pago = 'tarjeta' AND g.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
    );

  v_gastos_total := v_gastos_operativos + v_gastos_estructura + v_gastos_financieros + v_gastos_otros;

  SELECT COALESCE(SUM(monto), 0)
  INTO v_financial_income
  FROM otros_ingresos
  WHERE club_id = v_club_id AND activo = true AND unidad_tipo = 'financiero'
    AND fecha >= v_desde AND fecha <= v_hasta
    AND (
      p_medio_pago IS NULL 
      OR medio_pago = p_medio_pago 
      OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
      OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
    );

  v_margen_bruto := v_ingresos_total - v_costos_directos - v_gastos_operativos;
  v_resultado_operativo := v_margen_bruto - v_gastos_estructura;
  v_net_financial_result := v_financial_income - v_gastos_financieros;
  v_resultado_neto := v_resultado_operativo + v_net_financial_result;
  IF v_ingresos_total > 0 THEN
    v_margen_porcentaje := (v_resultado_neto / v_ingresos_total) * 100;
  ELSE
    v_margen_porcentaje := 0;
  END IF;

  WITH gastos_agrupados AS (
    SELECT g.categoria_nombre, g.unidad_nombre, g.unidad_tipo, SUM(g.monto) AS monto
    FROM gastos g
    WHERE g.club_id = v_club_id AND g.activo = true
      AND g.clasificacion <> 'DIRECT_MERCHANDISE'
      AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta
      AND (
        p_medio_pago IS NULL 
        OR g.medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND g.medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND g.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
    GROUP BY g.categoria_nombre, g.unidad_nombre, g.unidad_tipo
    ORDER BY monto DESC
    LIMIT 8
  )
  SELECT COALESCE(
    json_agg(json_build_object(
      'categoria_nombre', categoria_nombre,
      'unidad_nombre', unidad_nombre,
      'unidad_tipo', unidad_tipo,
      'monto', monto
    )),
    '[]'::json
  )
  INTO v_json_top_gastos
  FROM gastos_agrupados;

  WITH movs AS (
    SELECT
      'oi-' || fecha || '-' || unidad_nombre || '-' || monto::text AS id,
      'otro_ingreso' AS tipo, fecha::text AS fecha, unidad_nombre AS descripcion,
      NULL::text AS detalle, monto, '+' AS signo
    FROM otros_ingresos
    WHERE club_id = v_club_id AND activo = true AND fecha >= v_desde AND fecha <= v_hasta
      AND (
        p_medio_pago IS NULL 
        OR medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
    UNION ALL
    SELECT
      'g-' || g.id::text, 'gasto', g.fecha_gasto::text, g.categoria_nombre,
      COALESCE(g.proveedor, g.unidad_nombre), g.monto, '-'
    FROM gastos g
    WHERE g.club_id = v_club_id AND g.activo = true
      AND g.clasificacion <> 'DIRECT_MERCHANDISE'
      AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta
      AND (
        p_medio_pago IS NULL 
        OR g.medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND g.medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND g.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
    UNION ALL
    SELECT
      'v-' || v.id::text, 'venta', v.fecha_hora::text,
      'Venta mostrador #' || v.id::text, NULL::text, v.monto_total, '+'
    FROM (
      SELECT id, fecha_hora, monto_total
      FROM ventas v
      WHERE club_id = v_club_id AND activa = TRUE
        AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
        AND (
          p_medio_pago IS NULL
          OR EXISTS (
            SELECT 1 FROM venta_pagos vp 
            WHERE vp.venta_id = v.id 
              AND (
                vp.medio_pago = p_medio_pago 
                OR (p_medio_pago IN ('mp', 'mercado_pago') AND vp.medio_pago IN ('mp', 'mercado_pago'))
                OR (p_medio_pago = 'tarjeta' AND vp.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
              )
          )
          OR (
            v.medio_pago = p_medio_pago 
            OR (p_medio_pago IN ('mp', 'mercado_pago') AND v.medio_pago IN ('mp', 'mercado_pago'))
            OR (p_medio_pago = 'tarjeta' AND v.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
          )
        )
      ORDER BY fecha_hora DESC
      LIMIT 5
    ) v
  )
  SELECT COALESCE(json_agg(json_build_object(
    'id', id, 'tipo', tipo, 'fecha', fecha, 'descripcion', descripcion,
    'detalle', detalle, 'monto', monto, 'signo', signo
  )), '[]'::json)
  INTO v_json_movimientos
  FROM (SELECT * FROM movs ORDER BY fecha DESC LIMIT 15) sorted_movs;

  WITH dias AS (
    SELECT generate_series(v_desde, v_hasta, '1 day'::interval)::date AS fecha
  ),
  pagos_dia AS (
    SELECT (fecha_hora AT TIME ZONE 'UTC')::date AS fecha,
      SUM(CASE WHEN tipo = 'reembolso' THEN -monto_alquiler ELSE monto_alquiler END) AS monto
    FROM reserva_pagos
    WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
      AND (
        p_medio_pago IS NULL 
        OR medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
    GROUP BY 1
  ),
  clases_dia AS (
    SELECT (fecha_hora AT TIME ZONE 'UTC')::date AS fecha, SUM(monto) AS monto
    FROM clase_cobros
    WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
      AND (
        p_medio_pago IS NULL 
        OR medio_pago = p_medio_pago 
        OR (p_medio_pago IN ('mp', 'mercado_pago') AND medio_pago IN ('mp', 'mercado_pago'))
        OR (p_medio_pago = 'tarjeta' AND medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
      )
    GROUP BY 1
  ),
  ventas_dia AS (
    SELECT (v.fecha_hora AT TIME ZONE 'UTC')::date AS fecha, SUM(v.monto_total) AS monto
    FROM ventas v
    WHERE v.club_id = v_club_id AND v.activa = TRUE
      AND v.fecha_hora >= v_desde_iso AND v.fecha_hora <= v_hasta_iso
      AND (
        p_medio_pago IS NULL
        OR EXISTS (
          SELECT 1 FROM venta_pagos vp 
          WHERE vp.venta_id = v.id 
            AND (
              vp.medio_pago = p_medio_pago 
              OR (p_medio_pago IN ('mp', 'mercado_pago') AND vp.medio_pago IN ('mp', 'mercado_pago'))
              OR (p_medio_pago = 'tarjeta' AND vp.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
            )
        )
        OR (
          v.medio_pago = p_medio_pago 
          OR (p_medio_pago IN ('mp', 'mercado_pago') AND v.medio_pago IN ('mp', 'mercado_pago'))
          OR (p_medio_pago = 'tarjeta' AND v.medio_pago IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'))
        )
      )
    GROUP BY 1
  ),
  monto_dia AS (
    SELECT d.fecha, EXTRACT(DAY FROM d.fecha)::int AS dia,
      COALESCE(p.monto, 0) + COALESCE(c.monto, 0) + COALESCE(v.monto, 0) AS monto
    FROM dias d
    LEFT JOIN pagos_dia p ON d.fecha = p.fecha
    LEFT JOIN clases_dia c ON d.fecha = c.fecha
    LEFT JOIN ventas_dia v ON d.fecha = v.fecha
  ),
  monto_dia_acumulado AS (
    SELECT fecha, dia, monto, SUM(monto) OVER (ORDER BY dia ASC) AS acumulado
    FROM monto_dia
  )
  SELECT COALESCE(json_agg(json_build_object(
    'fecha', fecha::text, 'dia', dia, 'monto', monto, 'acumulado', acumulado
  ) ORDER BY dia ASC), '[]'::json)
  INTO v_json_ingresos_diarios
  FROM monto_dia_acumulado;

  RETURN json_build_object(
    'mes', COALESCE(p_mes, EXTRACT(MONTH FROM v_desde)::int),
    'anio', COALESCE(p_anio, EXTRACT(YEAR FROM v_desde)::int),
    'desde', v_desde::text,
    'hasta', v_hasta::text,
    'medio_pago', p_medio_pago,
    'ingresos_total', v_ingresos_total,
    'ingresos_por_unidad', v_json_ingresos_por_unidad,
    'costos_directos', v_costos_directos,
    'costos_por_linea', v_json_costos_por_linea,
    'gastos_operativos', v_gastos_operativos,
    'gastos_estructura', v_gastos_estructura,
    'gastos_financieros', v_gastos_financieros,
    'gastos_otros', v_gastos_otros,
    'gastos_total', v_gastos_total,
    'financial_income', v_financial_income,
    'financial_expenses', v_gastos_financieros,
    'net_financial_result', v_net_financial_result,
    'resultado_neto', v_resultado_neto,
    'margen_bruto', v_margen_bruto,
    'resultado_operativo', v_resultado_operativo,
    'margen_porcentaje', v_margen_porcentaje,
    'top_gastos_categoria', v_json_top_gastos,
    'movimientos_recientes', v_json_movimientos,
    'compras_mercaderia_periodo', v_compras_mercaderia,
    'ingresos_diarios', v_json_ingresos_diarios
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_obtener_resumen_financiero(integer, integer, date, date, varchar) TO authenticated;
