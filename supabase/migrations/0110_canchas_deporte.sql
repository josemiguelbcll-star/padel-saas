-- ============================================================================
-- Migration 0110_canchas_deporte.sql
-- Agrega columna deporte a la tabla canchas (padel, tenis, pickleball, futbol, etc.)
-- ============================================================================

ALTER TABLE canchas
  ADD COLUMN IF NOT EXISTS deporte VARCHAR(40);

COMMENT ON COLUMN canchas.deporte IS
  'Deporte de la cancha: padel, tenis, pickleball, futbol, futbol_5, squash, basquet, otro. NULL = auto-detectar o padel por defecto.';

-- Backfill automático inicial basado en el nombre y tipo existentes
UPDATE canchas
SET deporte = 'tenis'
WHERE deporte IS NULL AND (
  LOWER(nombre) LIKE '%tenis%' OR LOWER(nombre) LIKE '%tennis%' OR
  LOWER(COALESCE(tipo, '')) LIKE '%tenis%' OR LOWER(COALESCE(tipo, '')) LIKE '%tennis%'
);

UPDATE canchas
SET deporte = 'pickleball'
WHERE deporte IS NULL AND (
  LOWER(nombre) LIKE '%pickleball%' OR LOWER(nombre) LIKE '%piketbol%' OR
  LOWER(COALESCE(tipo, '')) LIKE '%pickleball%' OR LOWER(COALESCE(tipo, '')) LIKE '%piketbol%'
);

UPDATE canchas
SET deporte = 'futbol_5'
WHERE deporte IS NULL AND (
  LOWER(nombre) LIKE '%futbol 5%' OR LOWER(nombre) LIKE '%fútbol 5%' OR LOWER(nombre) LIKE '%f5%' OR
  LOWER(COALESCE(tipo, '')) LIKE '%futbol 5%' OR LOWER(COALESCE(tipo, '')) LIKE '%fútbol 5%'
);

UPDATE canchas
SET deporte = 'futbol'
WHERE deporte IS NULL AND (
  LOWER(nombre) LIKE '%futbol%' OR LOWER(nombre) LIKE '%fútbol%' OR
  LOWER(COALESCE(tipo, '')) LIKE '%futbol%' OR LOWER(COALESCE(tipo, '')) LIKE '%fútbol%'
);

UPDATE canchas
SET deporte = 'padel'
WHERE deporte IS NULL;
