-- ============================================================================
-- 0097_redefinir_rpc_eerr.sql
-- Módulo Financiero — Fase 2 (Redefinición de la RPC EERR).
--
-- =====================================================================
-- DETALLE DE CAMBIOS
-- =====================================================================
-- Redefine fn_obtener_resumen_financiero(p_anio, p_mes) para:
--   1. Calcular subtotales basados en la columna `clasificacion` de
--      categorias_gasto en lugar de filtrar por unidad_tipo.
--   2. Implementar la fórmula con signos explícitos:
--      net_financial_result = financial_income - financial_expenses
--      net_result = EBITDA + net_financial_result
--   3. Renombrar la unidad 'Clases' por 'Escuela' en el JSON retornado.
--   4. Incorporar los campos 'financial_income' y 'financial_expenses'
--      en el JSON retornado para consumo del frontend.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_obtener_resumen_financiero(p_anio integer, p_mes integer)
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
  
  -- Ingresos por unidad
  v_ingreso_canchas numeric := 0;
  v_ingreso_clases numeric := 0;
  v_ventas_buffet_ingreso numeric := 0;
  v_ventas_shop_ingreso numeric := 0;
  v_consumos_buffet_ingreso numeric := 0;
  v_consumos_shop_ingreso numeric := 0;
  v_ingreso_buffet numeric := 0;
  v_ingreso_shop numeric := 0;
  
  -- Costos
  v_ventas_buffet_costo numeric := 0;
  v_ventas_shop_costo numeric := 0;
  v_consumos_buffet_costo numeric := 0;
  v_consumos_shop_costo numeric := 0;
  v_costo_buffet numeric := 0;
  v_costo_shop numeric := 0;
  v_costos_directos numeric := 0;
  
  -- Totales y Resultados
  v_ingresos_total numeric := 0;
  v_gastos_operativos numeric := 0; -- Representa DIRECT_OTHER en el nuevo EERR
  v_gastos_estructura numeric := 0; -- Representa STRUCTURE
  v_gastos_financieros numeric := 0; -- Representa FINANCIAL
  v_gastos_otros numeric := 0; -- Escape por seguridad
  v_compras_mercaderia numeric := 0; -- DIRECT_MERCHANDISE (compras stock)
  v_gastos_total numeric := 0;
  
  v_financial_income numeric := 0; -- Ingresos financieros
  v_net_financial_result numeric := 0; -- Resultado financiero neto
  v_resultado_neto numeric := 0;
  v_margen_bruto numeric := 0;
  v_resultado_operativo numeric := 0;
  v_margen_porcentaje numeric := 0;
  
  -- JSONs
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

  -- Calcular rangos de fechas del período
  v_desde := (p_anio || '-' || LPAD(p_mes::text, 2, '0') || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  v_desde_iso := (v_desde::text || ' 00:00:00')::timestamp;
  v_hasta_iso := (v_hasta::text || ' 23:59:59')::timestamp;

  -- 1. Ingreso de canchas (reserva_pagos, reembolsos restan)
  SELECT COALESCE(SUM(CASE WHEN tipo = 'reembolso' THEN -monto_alquiler ELSE monto_alquiler END), 0)
  INTO v_ingreso_canchas
  FROM reserva_pagos
  WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso;

  -- 2. Ingreso de clases / escuela (clase_cobros)
  SELECT COALESCE(SUM(monto), 0)
  INTO v_ingreso_clases
  FROM clase_cobros
  WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso;

  -- 3. Ventas de buffet/shop de mostrador (venta_items + ventas)
  SELECT 
    COALESCE(SUM(CASE WHEN vi.linea = 'buffet' THEN vi.precio_unitario * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'shop' THEN vi.precio_unitario * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'buffet' THEN COALESCE(vi.costo_unitario, 0) * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'shop' THEN COALESCE(vi.costo_unitario, 0) * vi.cantidad ELSE 0 END), 0)
  INTO v_ventas_buffet_ingreso, v_ventas_shop_ingreso, v_ventas_buffet_costo, v_ventas_shop_costo
  FROM venta_items vi
  JOIN ventas v ON vi.venta_id = v.id
  WHERE v.club_id = v_club_id AND v.fecha_hora >= v_desde_iso AND v.fecha_hora <= v_hasta_iso;

  -- 4. Consumos de turnos (reserva_consumos)
  WITH candidatos AS (
    SELECT DISTINCT rp.reserva_id 
    FROM reserva_pagos rp
    WHERE rp.club_id = v_club_id 
      AND rp.monto_consumo > 0 
      AND rp.fecha_hora >= v_desde_iso 
      AND rp.fecha_hora <= v_hasta_iso
  ),
  ya_contados AS (
    SELECT DISTINCT rp.reserva_id 
    FROM reserva_pagos rp
    WHERE rp.club_id = v_club_id 
      AND rp.monto_consumo > 0 
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
  INTO v_consumos_buffet_ingreso, v_consumos_shop_ingreso, v_consumos_buffet_costo, v_consumos_shop_costo
  FROM reserva_consumos rc
  WHERE rc.club_id = v_club_id AND rc.reserva_id IN (SELECT reserva_id FROM candidatos_filtrados);

  -- Consolidar totales de Buffet y Shop
  v_ingreso_buffet := v_ventas_buffet_ingreso + v_consumos_buffet_ingreso;
  v_ingreso_shop := v_ventas_shop_ingreso + v_consumos_shop_ingreso;
  v_costo_buffet := v_ventas_buffet_costo + v_consumos_buffet_costo;
  v_costo_shop := v_ventas_shop_costo + v_consumos_shop_costo;
  v_costos_directos := v_costo_buffet + v_costo_shop;

  -- 5. Consolidar ingresos por unidad en JSON (incluyendo otros_ingresos, agrupados y sin financiero)
  WITH otros_agrupados AS (
    SELECT unidad_nombre AS unidad, unidad_tipo AS tipo, SUM(monto) AS monto
    FROM otros_ingresos
    WHERE club_id = v_club_id AND activo = true AND unidad_tipo <> 'financiero' AND fecha >= v_desde AND fecha <= v_hasta
    GROUP BY unidad_nombre, unidad_tipo
  ),
  unidades_unidas AS (
    SELECT 'Canchas' AS unidad, 'canchas' AS tipo, v_ingreso_canchas AS monto WHERE v_ingreso_canchas > 0
    UNION ALL
    SELECT 'Escuela' AS unidad, 'clases' AS tipo, v_ingreso_clases AS monto WHERE v_ingreso_clases > 0
    UNION ALL
    SELECT 'Buffet' AS unidad, 'buffet' AS tipo, v_ingreso_buffet AS monto WHERE v_ingreso_buffet > 0
    UNION ALL
    SELECT 'Shop' AS unidad, 'shop' AS tipo, v_ingreso_shop AS monto WHERE v_ingreso_shop > 0
    UNION ALL
    SELECT unidad, tipo, monto FROM otros_agrupados WHERE monto > 0
  ),
  unidades_agrupadas AS (
    SELECT unidad, tipo, SUM(monto) AS monto
    FROM unidades_unidas
    GROUP BY unidad, tipo
  )
  SELECT COALESCE(json_agg(json_build_object('unidad', unidad, 'tipo', tipo, 'monto', monto) ORDER BY monto DESC), '[]'::json)
  INTO v_json_ingresos_por_unidad
  FROM unidades_agrupadas;

  -- Calcular total general de ingresos (excluyendo financiero para separar EERR de ingresos financieros)
  v_ingresos_total := v_ingreso_canchas + v_ingreso_clases + v_ingreso_buffet + v_ingreso_shop + 
                      COALESCE((SELECT SUM(monto) FROM otros_ingresos WHERE club_id = v_club_id AND activo = true AND unidad_tipo <> 'financiero' AND fecha >= v_desde AND fecha <= v_hasta), 0);

  -- 6. Costos por línea en JSON
  WITH lineas_todas AS (
    SELECT 'buffet' AS linea, v_costo_buffet AS monto WHERE v_costo_buffet > 0
    UNION ALL
    SELECT 'shop' AS linea, v_costo_shop AS monto WHERE v_costo_shop > 0
  )
  SELECT COALESCE(json_agg(json_build_object('linea', linea, 'monto', monto) ORDER BY monto DESC), '[]'::json)
  INTO v_json_costos_por_linea
  FROM lineas_todas;

  -- 7. Gastos del mes clasificados según la columna `clasificacion` (excluyendo mercadería)
  SELECT 
    COALESCE(SUM(CASE WHEN g.clasificacion = 'DIRECT_OTHER' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'STRUCTURE' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'FINANCIAL' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion NOT IN ('DIRECT_MERCHANDISE', 'DIRECT_OTHER', 'STRUCTURE', 'FINANCIAL') THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'DIRECT_MERCHANDISE' THEN g.monto ELSE 0 END), 0)
  INTO 
    v_gastos_operativos, v_gastos_estructura, v_gastos_financieros, v_gastos_otros, v_compras_mercaderia
  FROM gastos g
  WHERE g.club_id = v_club_id AND g.activo = true AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta;

  v_gastos_total := v_gastos_operativos + v_gastos_estructura + v_gastos_financieros + v_gastos_otros;

  -- Calcular ingresos financieros (otros_ingresos tipo 'financiero')
  SELECT COALESCE(SUM(monto), 0)
  INTO v_financial_income
  FROM otros_ingresos
  WHERE club_id = v_club_id AND activo = true AND unidad_tipo = 'financiero' AND fecha >= v_desde AND fecha <= v_hasta;

  -- 8. Resultados y márgenes con fórmulas de signos explícitos
  v_margen_bruto := v_ingresos_total - v_costos_directos - v_gastos_operativos;
  v_resultado_operativo := v_margen_bruto - v_gastos_estructura; -- EBITDA
  v_net_financial_result := v_financial_income - v_gastos_financieros;
  v_resultado_neto := v_resultado_operativo + v_net_financial_result; -- Antes de Impuestos
  
  IF v_ingresos_total > 0 THEN
    v_margen_porcentaje := (v_resultado_neto / v_ingresos_total) * 100;
  ELSE
    v_margen_porcentaje := 0;
  END IF;

  -- 9. Top categorías de gasto (sin mercadería)
  WITH gastos_agrupados AS (
    SELECT g.categoria_nombre, g.unidad_nombre, g.unidad_tipo, SUM(g.monto) AS monto
    FROM gastos g
    WHERE g.club_id = v_club_id AND g.activo = true AND g.clasificacion <> 'DIRECT_MERCHANDISE' AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta
    GROUP BY g.categoria_nombre, g.unidad_nombre, g.unidad_tipo
    ORDER BY monto DESC
    LIMIT 8
  )
  SELECT COALESCE(json_agg(json_build_object('categoria_nombre', categoria_nombre, 'unidad_nombre', unidad_nombre, 'unidad_tipo', unidad_tipo, 'monto', monto)), '[]'::json)
  INTO v_json_top_gastos
  FROM gastos_agrupados;

  -- 10. Movimientos recientes mixtos (últimos 15 sin mercadería)
  WITH movs AS (
    SELECT 
      'oi-' || fecha || '-' || unidad_nombre || '-' || monto::text AS id,
      'otro_ingreso' AS tipo,
      fecha::text AS fecha,
      unidad_nombre AS descripcion,
      NULL::text AS detalle,
      monto,
      '+' AS signo
    FROM otros_ingresos
    WHERE club_id = v_club_id AND activo = true AND fecha >= v_desde AND fecha <= v_hasta
    
    UNION ALL
    
    SELECT 
      'g-' || g.id::text AS id,
      'gasto' AS tipo,
      g.fecha_gasto::text AS fecha,
      g.categoria_nombre AS descripcion,
      COALESCE(g.proveedor, g.unidad_nombre) AS detalle,
      g.monto,
      '-' AS signo
    FROM gastos g
    WHERE g.club_id = v_club_id AND g.activo = true AND g.clasificacion <> 'DIRECT_MERCHANDISE' AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta
    
    UNION ALL
    
    SELECT 
      'v-' || v.id::text AS id,
      'venta' AS tipo,
      v.fecha_hora::text AS fecha,
      'Venta mostrador #' || v.id::text AS descripcion,
      NULL::text AS detalle,
      v.monto_total AS monto,
      '+' AS signo
    FROM (
      SELECT id, fecha_hora, monto_total 
      FROM ventas 
      WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
      ORDER BY fecha_hora DESC
      LIMIT 5
    ) v
  )
  SELECT COALESCE(json_agg(json_build_object(
    'id', id,
    'tipo', tipo,
    'fecha', fecha,
    'descripcion', descripcion,
    'detalle', detalle,
    'monto', monto,
    'signo', signo
  )), '[]'::json)
  INTO v_json_movimientos
  FROM (
    SELECT * FROM movs
    ORDER BY fecha DESC
    LIMIT 15
  ) sorted_movs;

  -- 11. Serie de Ingresos Diarios
  WITH dias AS (
    SELECT generate_series(v_desde, v_hasta, '1 day'::interval)::date AS fecha
  ),
  pagos_dia AS (
    SELECT 
      (fecha_hora AT TIME ZONE 'UTC')::date AS fecha,
      SUM(CASE WHEN tipo = 'reembolso' THEN -monto ELSE monto END) AS monto
    FROM reserva_pagos
    WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
    GROUP BY 1
  ),
  clases_dia AS (
    SELECT 
      (fecha_hora AT TIME ZONE 'UTC')::date AS fecha,
      SUM(monto) AS monto
    FROM clase_cobros
    WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
    GROUP BY 1
  ),
  ventas_dia AS (
    SELECT 
      (fecha_hora AT TIME ZONE 'UTC')::date AS fecha,
      SUM(monto_total) AS monto
    FROM ventas
    WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
    GROUP BY 1
  ),
  otros_dia AS (
    SELECT 
      fecha,
      SUM(monto) AS monto
    FROM otros_ingresos
    WHERE club_id = v_club_id AND activo = true AND fecha >= v_desde AND fecha <= v_hasta
    GROUP BY 1
  ),
  monto_dia AS (
    SELECT 
      d.fecha,
      EXTRACT(DAY FROM d.fecha)::int AS dia,
      COALESCE(p.monto, 0) + COALESCE(c.monto, 0) + COALESCE(v.monto, 0) + COALESCE(o.monto, 0) AS monto
    FROM dias d
    LEFT JOIN pagos_dia p ON d.fecha = p.fecha
    LEFT JOIN clases_dia c ON d.fecha = c.fecha
    LEFT JOIN ventas_dia v ON d.fecha = v.fecha
    LEFT JOIN otros_dia o ON d.fecha = o.fecha
  ),
  monto_dia_acumulado AS (
    SELECT 
      fecha,
      dia,
      monto,
      SUM(monto) OVER (ORDER BY dia ASC) AS acumulado
    FROM monto_dia
  )
  SELECT COALESCE(json_agg(json_build_object(
    'fecha', fecha::text,
    'dia', dia,
    'monto', monto,
    'acumulado', acumulado
  ) ORDER BY dia ASC), '[]'::json)
  INTO v_json_ingresos_diarios
  FROM monto_dia_acumulado;

  -- 12. Retornar el payload unificado
  RETURN json_build_object(
    'mes', p_mes,
    'anio', p_anio,
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
