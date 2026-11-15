-- ============================================================================
-- Migración 0157: Agregar talla y color opcionales a productos (Shop / Vestimenta)
-- ============================================================================
BEGIN;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS talla TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT;

COMMENT ON COLUMN public.productos.talla IS 'Talla del producto (ej: S, M, L, XL, 42). Opcional, principalmente para shop/vestimenta.';
COMMENT ON COLUMN public.productos.color IS 'Color del producto (ej: Negro, Blanco, Azul). Opcional, principalmente para shop/vestimenta.';

-- Actualizar la vista vw_productos_con_stock si existe para incluir talla y color
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'vw_productos_con_stock'
  ) THEN
    CREATE OR REPLACE VIEW public.vw_productos_con_stock AS
    SELECT
      p.id,
      p.club_id,
      p.nombre,
      p.linea,
      p.categoria,
      p.precio,
      p.costo,
      p.stock_minimo,
      p.activo,
      p.fecha_alta,
      p.talla,
      p.color,
      COALESCE(s.stock_actual, 0) AS stock_actual
    FROM public.productos p
    LEFT JOIN (
      SELECT
        producto_id,
        SUM(cantidad) AS stock_actual
      FROM public.movimientos_stock
      GROUP BY producto_id
    ) s ON s.producto_id = p.id;
  END IF;
END $$;

COMMIT;
