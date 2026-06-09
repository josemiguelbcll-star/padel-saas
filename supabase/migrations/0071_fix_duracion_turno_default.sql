-- 0071: corrige duracion_turno_default inválidos en clubes
-- El campo acepta solo [60, 90, 120, 150, 180, 240] (CHECK de 0003).
-- Valores fuera del set (ej. 1350 del seed inicial) causan que la grilla
-- pública muestre "Sin turnos configurados" o duraciones absurdas.
-- Fallback: 60 min (el mínimo válido más conservador).

UPDATE clubes
SET duracion_turno_default = 60
WHERE duracion_turno_default NOT IN (60, 90, 120, 150, 180, 240);
