-- ============================================================================
-- Migración 0157: Agregar talla y color opcionales a productos (Shop / Vestimenta)
-- ============================================================================
BEGIN;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS talla TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT;

COMMENT ON COLUMN public.productos.talla IS 'Talla del producto (ej: S, M, L, XL, 42). Opcional, principalmente para shop/vestimenta.';
COMMENT ON COLUMN public.productos.color IS 'Color del producto (ej: Negro, Blanco, Azul). Opcional, principalmente para shop/vestimenta.';

-- Recrear vw_productos_con_stock con DROP VIEW para evitar error 42P16
DROP VIEW IF EXISTS public.vw_productos_con_stock;

CREATE VIEW public.vw_productos_con_stock
WITH (security_invoker = true)
AS
SELECT
  p.*,
  COALESCE(SUM(m.cantidad), 0)::INT AS stock_actual
FROM public.productos p
LEFT JOIN public.movimientos_stock m ON m.producto_id = p.id
GROUP BY p.id;

GRANT SELECT ON public.vw_productos_con_stock TO authenticated;

COMMIT;
