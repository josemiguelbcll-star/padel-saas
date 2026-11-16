-- ============================================================================
-- Migration 0165: Corregir desglose por defecto de reserva_pagos (error 23514)
-- ============================================================================
-- Contexto
--   En producción las columnas monto_alquiler, monto_consumo y redondeo tienen
--   DEFAULT 0 y son NOT NULL. El trigger defensivo creado en la 0122 sólo
--   rellenaba el desglose cuando el valor venía NULL, así que con estos defaults
--   nunca se activaba: cualquier INSERT que omitiera el desglose (como el de la
--   versión desplegada de fn_crear_reserva) quedaba en (0 + 0 + 0) <> monto y
--   violaba reserva_pagos_desglose_check (SQLSTATE 23514).
--
--   Esta migración amplía el trigger para cubrir ese caso (desglose no provisto
--   = todos los componentes en 0) imputando el monto al alquiler. NO se modifica
--   la lógica de ninguna función que inserta pagos.
-- ============================================================================

BEGIN;

-- Guarda defensiva: en producción la columna ya existe (no-op). En un entorno
-- que aún no la tuviera, el trigger de abajo la necesita para cuadrar el CHECK.
ALTER TABLE public.reserva_pagos
  ADD COLUMN IF NOT EXISTS redondeo NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.trg_fn_reserva_pagos_default_desglose()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Caso 1: la fila no proveyó ningún componente del desglose (todos quedaron
  -- en 0 por DEFAULT) y hay un monto > 0 -> imputar todo al alquiler.
  IF COALESCE(NEW.monto_alquiler, 0) = 0
     AND COALESCE(NEW.monto_consumo, 0) = 0
     AND COALESCE(NEW.redondeo, 0) = 0
     AND COALESCE(NEW.monto, 0) <> 0 THEN
    NEW.monto_alquiler := NEW.monto;
    NEW.monto_consumo := 0;
    NEW.redondeo := 0;

  -- Caso 2: los dos componentes principales vinieron NULL -> todo al alquiler.
  ELSIF NEW.monto_alquiler IS NULL AND NEW.monto_consumo IS NULL THEN
    NEW.monto_alquiler := COALESCE(NEW.monto, 0);
    NEW.monto_consumo := 0;

  -- Caso 3: falta uno de los componentes -> calcularlo por diferencia.
  ELSIF NEW.monto_alquiler IS NULL THEN
    NEW.monto_alquiler := GREATEST(0,
      COALESCE(NEW.monto, 0) - COALESCE(NEW.monto_consumo, 0) - COALESCE(NEW.redondeo, 0));
  ELSIF NEW.monto_consumo IS NULL THEN
    NEW.monto_consumo := GREATEST(0,
      COALESCE(NEW.monto, 0) - COALESCE(NEW.monto_alquiler, 0) - COALESCE(NEW.redondeo, 0));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reserva_pagos_default_desglose ON public.reserva_pagos;
CREATE TRIGGER trg_reserva_pagos_default_desglose
  BEFORE INSERT OR UPDATE ON public.reserva_pagos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_reserva_pagos_default_desglose();

COMMIT;
