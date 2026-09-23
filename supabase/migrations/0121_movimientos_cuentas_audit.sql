-- ============================================================================
-- 0121_movimientos_cuentas_audit.sql
-- Auditoría de movimientos bancarios y tesorería por cuenta, período y usuario.
-- ============================================================================

CREATE OR REPLACE VIEW v_movimientos_cuenta_detalle
WITH (security_invoker = true) AS

  -- 1. Cobros de reservas (turnos, señas, reembolsos)
  SELECT
    ('reserva_pago_' || rp.id)::text AS id,
    rp.club_id,
    rp.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    rp.fecha_hora AS fecha_hora,
    'reserva_pago'::text AS origen,
    CASE 
      WHEN rp.tipo = 'reembolso' THEN 'Reembolso Turno'
      WHEN rp.tipo = 'sena' THEN 'Seña Turno'
      ELSE 'Cobro Turno'
    END::text AS concepto,
    COALESCE(rp.observaciones, 'Pago de turno')::text AS detalle,
    (CASE WHEN rp.tipo = 'reembolso' THEN -1 ELSE 1 END)::smallint AS signo,
    rp.monto::numeric(12,2) AS monto,
    rp.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM reserva_pagos rp
  JOIN cuentas c ON c.id = rp.cuenta_id
  LEFT JOIN usuarios u ON u.id = rp.usuario_id
  WHERE rp.cuenta_id IS NOT NULL

  UNION ALL

  -- 2. Cobros de clases
  SELECT
    ('clase_cobro_' || cc.id)::text AS id,
    cc.club_id,
    cc.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    cc.fecha_hora AS fecha_hora,
    'clase_cobro'::text AS origen,
    'Cobro Clase'::text AS concepto,
    COALESCE(cc.observaciones, 'Cobro de clase')::text AS detalle,
    1::smallint AS signo,
    cc.monto::numeric(12,2) AS monto,
    cc.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM clase_cobros cc
  JOIN cuentas c ON c.id = cc.cuenta_id
  LEFT JOIN usuarios u ON u.id = cc.usuario_id
  WHERE cc.cuenta_id IS NOT NULL

  UNION ALL

  -- 3. Ventas de buffet
  SELECT
    ('venta_' || v.id)::text AS id,
    v.club_id,
    v.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    v.fecha_hora AS fecha_hora,
    'venta'::text AS origen,
    'Venta Buffet'::text AS concepto,
    COALESCE(v.observaciones, 'Venta en buffet')::text AS detalle,
    1::smallint AS signo,
    v.monto_total::numeric(12,2) AS monto,
    v.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM ventas v
  JOIN cuentas c ON c.id = v.cuenta_id
  LEFT JOIN usuarios u ON u.id = v.usuario_id
  WHERE v.cuenta_id IS NOT NULL

  UNION ALL

  -- 4. Gastos directos pagados (activos)
  SELECT
    ('gasto_' || g.id)::text AS id,
    g.club_id,
    g.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    COALESCE(g.fecha_pago::timestamptz, g.fecha_gasto::timestamptz, g.fecha_alta) AS fecha_hora,
    'gasto'::text AS origen,
    COALESCE(g.categoria_nombre, 'Gasto')::text AS concepto,
    COALESCE(g.observaciones, g.proveedor, 'Gasto')::text AS detalle,
    (-1)::smallint AS signo,
    g.monto::numeric(12,2) AS monto,
    g.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM gastos g
  JOIN cuentas c ON c.id = g.cuenta_id
  LEFT JOIN usuarios u ON u.id = g.usuario_id
  WHERE g.cuenta_id IS NOT NULL
    AND g.activo = TRUE

  UNION ALL

  -- 5. Otros ingresos cobrados (activos)
  SELECT
    ('otro_ingreso_' || oi.id)::text AS id,
    oi.club_id,
    oi.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    COALESCE(oi.fecha_cobro::timestamptz, oi.fecha::timestamptz, oi.fecha_alta) AS fecha_hora,
    'otro_ingreso'::text AS origen,
    COALESCE(oi.concepto, 'Otro Ingreso')::text AS concepto,
    oi.observaciones::text AS detalle,
    1::smallint AS signo,
    oi.monto::numeric(12,2) AS monto,
    oi.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM otros_ingresos oi
  JOIN cuentas c ON c.id = oi.cuenta_id
  LEFT JOIN usuarios u ON u.id = oi.usuario_id
  WHERE oi.cuenta_id IS NOT NULL
    AND oi.activo = TRUE

  UNION ALL

  -- 6. Cuotas de gastos pagadas
  SELECT
    ('gasto_cuota_' || gc.id)::text AS id,
    gc.club_id,
    gc.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    COALESCE(gc.fecha_pago::timestamptz, gc.fecha_alta) AS fecha_hora,
    'gasto_cuota'::text AS origen,
    ('Pago Cuota Gasto #' || gc.gasto_id)::text AS concepto,
    ('Cuota ' || gc.numero)::text AS detalle,
    (-1)::smallint AS signo,
    gc.monto::numeric(12,2) AS monto,
    gc.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM gasto_cuotas gc
  JOIN cuentas c ON c.id = gc.cuenta_id
  LEFT JOIN usuarios u ON u.id = gc.usuario_id
  WHERE gc.cuenta_id IS NOT NULL
    AND gc.fecha_pago IS NOT NULL

  UNION ALL

  -- 7. Movimientos manuales de caja (efectivo)
  SELECT
    ('caja_manual_' || cm.id)::text AS id,
    cm.club_id,
    mcd.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    cm.fecha_hora AS fecha_hora,
    'caja_manual'::text AS origen,
    CASE 
      WHEN cm.tipo = 'ajuste_positivo' THEN 'Ingreso Manual Caja'
      ELSE 'Egreso Manual Caja'
    END::text AS concepto,
    COALESCE(cm.concepto, cm.observaciones, 'Movimiento manual de caja')::text AS detalle,
    (CASE WHEN cm.tipo = 'ajuste_positivo' THEN 1 ELSE -1 END)::smallint AS signo,
    cm.monto::numeric(12,2) AS monto,
    cm.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM caja_movimientos_manuales cm
  JOIN medio_cuenta_default mcd
    ON mcd.club_id = cm.club_id
   AND mcd.medio_pago = 'efectivo'
  JOIN cuentas c ON c.id = mcd.cuenta_id
  LEFT JOIN usuarios u ON u.id = cm.usuario_id

  UNION ALL

  -- 8. Transferencia: pata origen (egreso)
  SELECT
    ('transferencia_salida_' || tr.id)::text AS id,
    tr.club_id,
    tr.cuenta_origen_id AS cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    tr.fecha_hora AS fecha_hora,
    'transferencia_origen'::text AS origen,
    'Transferencia enviada'::text AS concepto,
    COALESCE(tr.concepto, tr.observaciones, ('Hacia ' || c_dest.nombre))::text AS detalle,
    (-1)::smallint AS signo,
    tr.monto::numeric(12,2) AS monto,
    tr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM transferencias tr
  JOIN cuentas c ON c.id = tr.cuenta_origen_id
  JOIN cuentas c_dest ON c_dest.id = tr.cuenta_destino_id
  LEFT JOIN usuarios u ON u.id = tr.usuario_id

  UNION ALL

  -- 9. Transferencia: pata destino (ingreso)
  SELECT
    ('transferencia_entrada_' || tr.id)::text AS id,
    tr.club_id,
    tr.cuenta_destino_id AS cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    tr.fecha_hora AS fecha_hora,
    'transferencia_destino'::text AS origen,
    'Transferencia recibida'::text AS concepto,
    COALESCE(tr.concepto, tr.observaciones, ('Desde ' || c_orig.nombre))::text AS detalle,
    1::smallint AS signo,
    tr.monto::numeric(12,2) AS monto,
    tr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM transferencias tr
  JOIN cuentas c ON c.id = tr.cuenta_destino_id
  JOIN cuentas c_orig ON c_orig.id = tr.cuenta_origen_id
  LEFT JOIN usuarios u ON u.id = tr.usuario_id;

COMMENT ON VIEW v_movimientos_cuenta_detalle IS
  'Auditoría y libro mayor de movimientos por cuenta con detalle de usuario, concepto y signo. Security invoker.';

GRANT SELECT ON v_movimientos_cuenta_detalle TO authenticated;
