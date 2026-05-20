-- ============================================================================
-- 0007_clase_cobros.sql
-- Sprint 3a — Cobro de clases (registro por ocurrencia)
--
-- Las clases son recurrentes (una fila en `clases` con dias_semana).
-- Para registrar "la clase de Emi del miércoles 20 está paga", esta
-- migración agrega la tabla `clase_cobros` que ata clase + fecha
-- puntual + cobro. Una UNIQUE (clase_id, fecha) previene cobrar dos
-- veces la misma ocurrencia.
--
-- Esta migración hace tres cosas:
--
--   1. Crea la tabla `clase_cobros` con su RLS y la UNIQUE constraint.
--   2. Crea el trigger `trg_clases_no_borrar_con_cobros` que rechaza
--      el DELETE de una clase si tiene cobros registrados, con un
--      mensaje claro en castellano. Defense in depth con el FK RESTRICT.
--   3. Crea la RPC atómica `fn_cobrar_clase` que valida + inserta el
--      cobro con SELECT FOR UPDATE sobre la clase (race-safe).
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). No toca el
-- cobro de reservas/partidos (`fn_cobrar_reserva` y `reserva_pagos`).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: clase_cobros
--
--    Cada fila = una ocurrencia cobrada (clase X dictada el día Y).
--
--    - club_id NOT NULL para RLS multi-tenant (regla CLAUDE.md nº 2).
--    - clase_id REFERENCES clases(id) ON DELETE RESTRICT: si la clase
--      tiene cobros, no se puede borrar. El admin la desactiva en su
--      lugar (campo activa=false que ya existe). Esto preserva la
--      trazabilidad financiera. Un mensaje custom en castellano lo
--      explica al usuario via el trigger de la sección 2.
--    - UNIQUE (clase_id, fecha): nunca dos cobros para la misma
--      ocurrencia (mismo clase y mismo día). Red de seguridad final
--      sobre el pre-check de la RPC.
--    - usuario_id NOT NULL: quién registró el cobro. Sin ON DELETE
--      (NO ACTION default): si el usuario es eliminado, no se puede
--      hasta que el cobro se mueva/elimine (preserva trazabilidad).
-- ============================================================================
CREATE TABLE clase_cobros (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  clase_id BIGINT NOT NULL REFERENCES clases(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  medio_pago VARCHAR(20) NOT NULL
    CHECK (medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro')),
  observaciones TEXT,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT clase_cobros_unique_ocurrencia UNIQUE (clase_id, fecha)
);

-- Índices: el UNIQUE ya crea uno sobre (clase_id, fecha).
-- Agregamos otros dos útiles para reportes y filtros.
CREATE INDEX idx_clase_cobros_clase ON clase_cobros(clase_id);
CREATE INDEX idx_clase_cobros_club_fecha ON clase_cobros(club_id, fecha);

COMMENT ON TABLE clase_cobros IS
  'Registro de cobros de clases por ocurrencia (clase + fecha puntual).
   Una fila por cada vez que el club cobra el alquiler al profesor. La
   UNIQUE (clase_id, fecha) previene doble cobro de la misma ocurrencia.';

COMMENT ON COLUMN clase_cobros.fecha IS
  'Fecha puntual de la ocurrencia cobrada (ej. el miércoles 2026-05-20).
   Tiene que coincidir con un día configurado en clases.dias_semana
   (validado por la RPC fn_cobrar_clase).';

COMMENT ON COLUMN clase_cobros.monto IS
  'Monto efectivamente cobrado. Default sugerido en la UI es clases.precio,
   pero el vendedor puede ajustarlo (caso real: arreglo por menos).';


-- ============================================================================
-- 2. GRANTs (RLS filtra después)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON clase_cobros TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE clase_cobros_id_seq TO authenticated;


-- ============================================================================
-- 3. RLS — clase_cobros
--    Mismo patrón que reserva_pagos: SELECT+INSERT abierto a authenticated
--    del club; UPDATE+DELETE sólo admin (trazabilidad financiera).
-- ============================================================================
ALTER TABLE clase_cobros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clase_cobros_select"
ON clase_cobros FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "clase_cobros_insert"
ON clase_cobros FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "clase_cobros_update_solo_admin"
ON clase_cobros FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "clase_cobros_delete_solo_admin"
ON clase_cobros FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 4. Trigger: bloquear DELETE de una clase si tiene cobros
--
--    El FK RESTRICT ya prevendría el DELETE con SQLSTATE 23503, pero el
--    mensaje genérico ("foreign key violation") no le dice al usuario
--    qué hacer. Este trigger BEFORE DELETE corre primero y tira un
--    RAISE EXCEPTION en castellano con la acción correcta.
--
--    Defense in depth: si por algún motivo el trigger no se disparara,
--    el FK RESTRICT igual bloquea la operación. Cinturón y tiradores.
--
--    SECURITY INVOKER + SET search_path = public (mismo patrón que el
--    trigger de no-overlap de la migración 0005).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_check_clase_sin_cobros()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM clase_cobros WHERE clase_id = OLD.id) THEN
    RAISE EXCEPTION
      'No se puede borrar la clase porque tiene cobros registrados. Desactivala en su lugar (campo "Activa" en off).';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION fn_check_clase_sin_cobros IS
  'Trigger BEFORE DELETE en clases. Rechaza el borrado si hay cobros
   asociados, con mensaje accionable que sugiere desactivar la clase.';

CREATE TRIGGER trg_clases_no_borrar_con_cobros
BEFORE DELETE ON clases
FOR EACH ROW EXECUTE FUNCTION fn_check_clase_sin_cobros();


-- ============================================================================
-- 5. RPC: fn_cobrar_clase
--
--    Inputs:
--      p_clase_id      Clase recurrente sobre la que se cobra.
--      p_fecha         Fecha puntual de la ocurrencia.
--      p_monto         Monto a cobrar (editable; default UI = clases.precio).
--      p_medio_pago    'efectivo'/'transferencia'/'mp'/'tarjeta'/'otro'.
--      p_observaciones Texto opcional.
--
--    Mensajes de error (todos P0001 → pasan directo via dbErrors):
--      - 'No hay sesión activa.'
--      - 'El monto a cobrar debe ser mayor a 0.'
--      - 'El medio de pago es obligatorio.'
--      - 'La clase no existe o no pertenece a tu club.'
--      - 'La clase no se dicta el % — revisá los días configurados.'
--      - 'La clase del % ya fue cobrada.'
--
--    Concurrencia: SELECT FOR UPDATE sobre la fila de la clase serializa
--    cobros concurrentes a la misma clase. La UNIQUE (clase_id, fecha)
--    es el backstop si dos transacciones logran colarse.
--
--    No valida el estado `activa` de la clase: se permite cobrar
--    ocurrencias de clases desactivadas (caso histórico/regularización).
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

  -- Lock exclusivo de la clase: serializa cobros concurrentes sobre la
  -- misma fila. Dos vendedores cobrando la misma (clase, fecha) → el
  -- segundo espera y al continuar ve el cobro del primero ya
  -- commiteado, fallando con "ya fue cobrada".
  SELECT * INTO v_clase
  FROM clases
  WHERE id = p_clase_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece a tu club.';
  END IF;

  -- Validar que la fecha cae en uno de los días configurados.
  -- EXTRACT(ISODOW) devuelve 1 (lunes) a 7 (domingo), espejo de la
  -- convención que usamos en todo el sistema.
  IF NOT (EXTRACT(ISODOW FROM p_fecha)::INT = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION
      'La clase no se dicta el % — revisá los días configurados.', p_fecha;
  END IF;

  -- Pre-check explícito para dar un mensaje claro. La UNIQUE constraint
  -- es el backstop si una transacción concurrente se cuela entre este
  -- check y el INSERT.
  IF EXISTS (
    SELECT 1 FROM clase_cobros
    WHERE clase_id = p_clase_id AND fecha = p_fecha
  ) THEN
    RAISE EXCEPTION 'La clase del % ya fue cobrada.', p_fecha;
  END IF;

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
  'Registra un cobro de una ocurrencia de clase. SELECT FOR UPDATE +
   UNIQUE (clase_id, fecha) previenen doble cobro. Valida que la fecha
   coincida con dias_semana de la clase.';

GRANT EXECUTE ON FUNCTION fn_cobrar_clase(
  BIGINT, DATE, DECIMAL, VARCHAR, TEXT
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0007_clase_cobros.sql
-- ============================================================================
