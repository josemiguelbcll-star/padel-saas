-- ============================================================================
-- 0044_ampliar_condicion_fiscal.sql
-- Fix: condicion_fiscal (clubes) y condicion_fiscal_club (compras) eran
-- VARCHAR(20), pero 'responsable_inscripto' tiene 21 caracteres y no
-- entraba. Se amplían a VARCHAR(30). Los CHECK IN siguen válidos (validan
-- contenido, no largo); ampliar el tipo no los rompe ni requiere recrearlos.
-- ============================================================================

BEGIN;

ALTER TABLE clubes
  ALTER COLUMN condicion_fiscal TYPE VARCHAR(30);

ALTER TABLE compras
  ALTER COLUMN condicion_fiscal_club TYPE VARCHAR(30);

COMMIT;
