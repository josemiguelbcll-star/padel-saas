BEGIN;

CREATE OR REPLACE VIEW public.v_movimientos_cuenta_detalle
WITH (security_invoker = true) AS
  SELECT
    base.id,
    base.club_id,
    base.cuenta_id,
    base.cuenta_nombre,
    base.tipo_cuenta,
    base.fecha_hora,
    CASE
      WHEN correccion.venta_id IS NOT NULL THEN 'venta_correccion'::text
      ELSE base.origen
    END AS origen,
    CASE
      WHEN correccion.venta_id IS NOT NULL THEN 'Corrección de venta'::text
      ELSE base.concepto
    END AS concepto,
    CASE
      WHEN correccion.venta_id IS NOT NULL
        THEN ('Corrección de venta #' || correccion.venta_id || ' · ' || COALESCE(base.detalle, ''))::text
      ELSE base.detalle
    END AS detalle,
    base.signo,
    base.monto,
    base.usuario_id,
    base.usuario_nombre,
    base.usuario_rol
  FROM public.v_movimientos_cuenta_detalle_sin_reversion base
  LEFT JOIN LATERAL (
    SELECT vc.venta_id
    FROM public.venta_pagos vp
    JOIN public.ventas_correcciones vc
      ON vc.venta_reemplazo_id = vp.venta_id
     AND vc.club_id = vp.club_id
    WHERE base.origen = 'venta'
      AND base.id = ('venta_pago_' || vp.id)::text
    ORDER BY vc.id DESC
    LIMIT 1
  ) correccion ON TRUE

  UNION ALL
  SELECT
    ('transferencia_origen_' || tr.id)::text,
    tr.club_id,
    tr.cuenta_origen_id,
    c.nombre,
    c.tipo,
    tr.fecha_hora,
    'transferencia_origen'::text,
    'Transferencia enviada'::text,
    COALESCE(tr.concepto, tr.observaciones, 'Transferencia')::text,
    (-1)::smallint,
    tr.monto::numeric(12,2),
    tr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text,
    u.rol
  FROM public.transferencias tr
  JOIN public.cuentas c ON c.id = tr.cuenta_origen_id AND c.club_id = tr.club_id
  LEFT JOIN public.usuarios u ON u.id = tr.usuario_id

  UNION ALL
  SELECT
    ('transferencia_destino_' || tr.id)::text,
    tr.club_id,
    tr.cuenta_destino_id,
    c.nombre,
    c.tipo,
    tr.fecha_hora,
    'transferencia_destino'::text,
    'Transferencia recibida'::text,
    COALESCE(tr.concepto, tr.observaciones, 'Transferencia')::text,
    1::smallint,
    tr.monto::numeric(12,2),
    tr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text,
    u.rol
  FROM public.transferencias tr
  JOIN public.cuentas c ON c.id = tr.cuenta_destino_id AND c.club_id = tr.club_id
  LEFT JOIN public.usuarios u ON u.id = tr.usuario_id

  UNION ALL
  SELECT
    ('venta_reversion_' || vpr.id)::text,
    vpr.club_id,
    vpr.cuenta_id,
    c.nombre,
    c.tipo,
    vpr.fecha_hora,
    CASE
      WHEN vc.venta_reemplazo_id IS NOT NULL THEN 'venta_correccion'::text
      ELSE 'venta_reversion'::text
    END,
    CASE
      WHEN vc.venta_reemplazo_id IS NOT NULL THEN 'Corrección de venta'::text
      ELSE 'Reversión venta'::text
    END,
    CASE
      WHEN vc.venta_reemplazo_id IS NOT NULL
        THEN ('Corrección de venta #' || vpr.venta_id || ' (' || vpr.medio_pago || ')')::text
      ELSE ('Anulación de venta #' || vpr.venta_id || ' (' || vpr.medio_pago || ')')::text
    END,
    (-1)::smallint,
    vpr.monto::numeric(12,2),
    vpr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text,
    u.rol
  FROM public.venta_pagos_reversiones vpr
  JOIN public.cuentas c ON c.id = vpr.cuenta_id
  LEFT JOIN public.usuarios u ON u.id = vpr.usuario_id
  LEFT JOIN public.ventas_correcciones vc
    ON vc.venta_id = vpr.venta_id AND vc.club_id = vpr.club_id
  WHERE vpr.cuenta_id IS NOT NULL AND c.es_caja_fisica = FALSE;

GRANT SELECT ON public.v_movimientos_cuenta_detalle TO authenticated;

COMMENT ON VIEW public.v_movimientos_cuenta_detalle IS
  'Libro mayor por cuenta. Una venta corregida conserva su fila original y muestra el reemplazo y la reversión como correcciones, no como ventas adicionales.';

COMMIT;
