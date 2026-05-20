-- ============================================================================
-- 0008_clase_cobros_varios_pagos.sql
-- Sprint 3a — Permitir varios pagos por (clase, fecha)
--
-- Cambio de modelo: una ocurrencia de clase (clase × fecha) ahora puede
-- tener CERO, UNO o VARIOS pagos. El total cobrado se calcula como la
-- suma de los montos. No hay total fijo a alcanzar; el precio configurado
-- en `clases.precio` queda como SUGERENCIA (pre-llena el monto en la UI
-- al agregar un pago, pero no es un check).
--
-- Esta migración hace dos cosas:
--
--   1. Dropea la UNIQUE (clase_id, fecha) en clase_cobros — permite
--      insertar múltiples filas para la misma ocurrencia.
--   2. CREATE OR REPLACE fn_cobrar_clase: saca el pre-check de "ya fue
--      cobrada"; ahora cada llamada inserta un pago más. Mantiene
--      validaciones de sesión/monto/medio/weekday y el SELECT FOR UPDATE
--      sobre `clases` (ahora protege contra race con DELETE de clase
--      concurrente, no contra doble cobro).
--
-- NO modifica la 0007 (regla CLAUDE.md nº 9). NO modifica el trigger
-- `trg_clases_no_borrar_con_cobros` ni el FK ON DELETE RESTRICT — siguen
-- bloqueando borrar una clase con cobros (uno o varios, da igual). NO
-- modifica las políticas RLS de clase_cobros (DELETE solo admin sigue
-- siendo el que gatea el botón "Borrar pago" en el dialog).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Dropear la UNIQUE (clase_id, fecha)
--
--    La constraint también dropea su índice implícito sobre (clase_id, fecha).
--    No agrego índice de reemplazo: el filtro principal de la app
--    (`useCobrosDelDia` por `fecha`) lo cubre `idx_clase_cobros_club_fecha`,
--    y el lookup por `clase_id` lo cubre `idx_clase_cobros_clase`.
-- ============================================================================
ALTER TABLE clase_cobros
  DROP CONSTRAINT clase_cobros_unique_ocurrencia;

-- Actualizo el COMMENT ON TABLE para reflejar el nuevo modelo. El de la
-- columna `fecha` sigue siendo correcto (se mantiene la validación de
-- weekday en la RPC), no lo toco.
COMMENT ON TABLE clase_cobros IS
  'Registro de cobros de clases por ocurrencia (clase + fecha puntual).
   Una ocurrencia puede tener cero, uno o varios pagos: el total cobrado
   es la suma de los montos. La UNIQUE (clase_id, fecha) original fue
   dropeada en la migración 0008.';


-- ============================================================================
-- 2. CREATE OR REPLACE fn_cobrar_clase
--
--    Misma signatura → la GRANT EXECUTE existente persiste sin tocar.
--    Cambios respecto de la versión 0007:
--      - Saco el pre-check "EXISTS … ya fue cobrada".
--      - Mantengo SELECT FOR UPDATE pero cambia su propósito (ver comment
--        inline). Ya no previene doble cobro; previene race con DELETE
--        de clase concurrente.
--
--    Mensajes de error que el usuario puede ver (todos P0001 → dbErrors):
--      - 'No hay sesión activa.'
--      - 'El monto a cobrar debe ser mayor a 0.'
--      - 'El medio de pago es obligatorio.'
--      - 'La clase no existe o no pertenece a tu club.'
--      - 'La clase no se dicta el % — revisá los días configurados.'
--
--    No se valida estado `activa` de la clase (cobros históricos siguen
--    permitidos, igual que en 0007).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cobrar_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_monto DECIMAL,
  p_medio_pago VARCHAR,
  p_observaciones TEXT
)
RETURNS clase_cobros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clase clases;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cobro clase_cobros;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- Lock exclusivo de la clase. Con varios pagos permitidos por
  -- ocurrencia, este lock ya no protege contra doble cobro (eso ahora
  -- es un caso de uso válido), pero sí protege contra una race entre
  -- nuestro INSERT y un DELETE de la clase concurrente: sin el lock,
  -- el SELECT podría ver la clase y el INSERT posterior fallaría con
  -- una FK violation genérica (23503). Con el lock, el DELETE espera
  -- nuestro commit y después es bloqueado por el FK RESTRICT + trigger
  -- con su mensaje accionable.
  SELECT * INTO v_clase
  FROM clases
  WHERE id = p_clase_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece a tu club.';
  END IF;

  -- Validar que la fecha cae en uno de los días configurados.
  IF NOT (EXTRACT(ISODOW FROM p_fecha)::INT = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION
      'La clase no se dicta el % — revisá los días configurados.', p_fecha;
  END IF;

  -- Insert directo. Sin pre-check de cobro previo: el modelo nuevo
  -- permite múltiples pagos por (clase, fecha).
  INSERT INTO clase_cobros (
    club_id, clase_id, fecha, monto, medio_pago, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, p_monto, p_medio_pago, p_observaciones, v_usuario_id
  )
  RETURNING * INTO v_cobro;

  RETURN v_cobro;
END;
$$;

COMMENT ON FUNCTION fn_cobrar_clase IS
  'Registra un pago sobre una ocurrencia de clase. Modelo de varios
   pagos por (clase, fecha) desde la migración 0008: cada llamada
   inserta una fila más; el total cobrado se calcula client-side como
   la suma de los montos. Valida sesión, monto, medio, existencia y
   que la fecha caiga en dias_semana de la clase.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0008_clase_cobros_varios_pagos.sql
-- ============================================================================
