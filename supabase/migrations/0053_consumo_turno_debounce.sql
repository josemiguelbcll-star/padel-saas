-- ============================================================================
-- 0053_consumo_turno_debounce.sql
-- fn_cargar_consumo_turno: debounce anti-doble-submit (server-side).
--
-- =====================================================================
-- CONTEXTO — POR QUÉ ESTA MIGRACIÓN
-- =====================================================================
-- Diagnóstico confirmado contra datos reales: la carga de consumos al
-- turno estaba duplicándose. Filas IDÉNTICAS (mismo reserva_id +
-- producto_id + cantidad) insertadas en ráfagas de <1 segundo
-- (reserva 93: 4 cocas con gap ~1s; reserva 88: 12 cervezas con gap
-- <1s; reserva 91: 9 pelotas con gap ~0,8s). Causa: doble-tap /
-- ghost-click táctil que se cuela por la VENTANA DE CARRERA del guard
-- `disabled={isPending}` del frontend (disabled tarda un render de
-- React en aplicarse). Cada fila duplicada también duplicó el descuento
-- de stock (el otro lado del bug) y, al moverse el consumo a su unidad
-- en el EERR, el ingreso de buffet aparecía 2× (el síntoma que destapó
-- todo).
--
-- El guard de frontend NO alcanza: ya existe y se cuela. La defensa
-- tiene que ser server-side.
--
-- =====================================================================
-- QUÉ HACE ESTA MIGRACIÓN
-- =====================================================================
-- CREATE OR REPLACE de fn_cargar_consumo_turno con UN SOLO agregado
-- respecto de la 0026:
--   ⭐ AGREGADO: un "debounce" anti-ráfaga. Tras tomar el lock del
--      producto (FOR UPDATE — que YA serializa dos cargas concurrentes
--      del mismo producto) y antes de validar stock e insertar, se busca
--      un consumo IDÉNTICO insertado en los últimos 2 segundos. Si
--      existe, es la ráfaga accidental: la función NO inserta nada
--      (ni reserva_consumos ni movimientos_stock) y devuelve la fila
--      ya existente. No-op idempotente, silencioso (sin error).
--
-- POR QUÉ ES RACE-SAFE (sin TOCTOU):
--   El `SELECT ... FROM productos ... FOR UPDATE` que ya existía toma
--   un lock exclusivo de la fila del producto. Dos llamadas de la misma
--   ráfaga (mismo producto) se SERIALIZAN en ese lock: la llamada B
--   espera a que A commitee y recién entonces corre su EXISTS, viendo
--   la fila que A acaba de insertar. La ventana "leer-luego-insertar"
--   queda cerrada por un lock que ya estaba.
--
-- POR QUÉ EL UMBRAL DE 2 SEGUNDOS (constante técnica, no config de club):
--   - Ráfaga accidental (doble-tap, ghost-click, rebote de hardware):
--     gap <1s (datos observados 0,8-1,0s). → BLOQUEAR.
--   - Segundo consumo deliberado (el cliente realmente pide otra): el
--     vendedor ve el "1×", decide y re-apunta → >1,5-2s. → PERMITIR.
--   2s queda por encima de la banda accidental (con margen ~2×) y por
--   debajo de la deliberada. Un eventual colapso de un alta legítima es
--   auto-corregible (el vendedor ve "1×" y vuelve a tocar pasados 2s);
--   el bug actual, en cambio, sobre-contaba de forma invisible. Errar
--   hacia "colapsar" es la dirección segura. El caso legítimo planteado
--   (2 cervezas en ~10s) cae muy por fuera de la ventana.
--
-- CLAVE DE "IDÉNTICO":
--   club_id + reserva_id + producto_id + cantidad + tipo_reparto +
--   usuario_id. Si CUALQUIERA difiere, es otra intención y SÍ inserta
--   (ej.: el mismo producto cargado 'general' y enseguida 'partido' son
--   dos consumos válidos; dos vendedores distintos jamás son ráfaga).
--
-- QUÉ SE MANTIENE IDÉNTICO respecto de la 0026:
--   - Toda la validación previa (sesión, cantidad, tipo_reparto,
--     reserva existe / del club / no cancelada, lock del producto,
--     check de producto existe / activo).
--   - El cálculo de stock bajo el lock y el rechazo por stock
--     insuficiente.
--   - El INSERT a reserva_consumos con todos sus snapshots
--     (nombre, precio, costo, subtotal, tipo_reparto, linea).
--   - El INSERT a movimientos_stock (salida atada al consumo).
--   - Signatura IDÉNTICA. El frontend no cambia su llamada.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR
)
RETURNS reserva_consumos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva reservas;
  v_producto productos;
  v_stock INT;
  v_consumo reserva_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  IF p_tipo_reparto IS NULL
     OR p_tipo_reparto NOT IN ('partido', 'general') THEN
    RAISE EXCEPTION 'Tipo de reparto inválido (esperado: partido o general).';
  END IF;

  -- Verificar reserva: existe, del club, no cancelada.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION
      'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  -- Lock exclusivo del producto: serializa con ventas y otras cargas
  -- concurrentes que toquen el stock del mismo producto.
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION
      'El producto "%" está desactivado, no se puede vender.',
      v_producto.nombre;
  END IF;

  -- ⭐ AGREGADO 0053 — DEBOUNCE ANTI-DOBLE-SUBMIT (server-side).
  -- Bajo el FOR UPDATE del producto (que serializa la ráfaga del mismo
  -- producto), buscamos un consumo IDÉNTICO insertado en los últimos
  -- 2 segundos. Si existe, es el doble-tap accidental: NO insertamos
  -- consumo NI movimiento de stock (CRÍTICO — insertar el movimiento
  -- descontaría el stock por segunda vez, que es el otro lado del bug)
  -- y devolvemos la fila ya existente. No-op idempotente y silencioso.
  -- El intervalo de 2s va como literal: es una constante técnica
  -- anti-ráfaga, no configuración de negocio por club.
  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE club_id      = v_club_id
    AND reserva_id   = p_reserva_id
    AND producto_id  = v_producto.id
    AND cantidad     = p_cantidad
    AND tipo_reparto = p_tipo_reparto
    AND usuario_id   = v_usuario_id
    AND fecha_hora  >= NOW() - INTERVAL '2 seconds'
  ORDER BY fecha_hora DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    -- Ráfaga accidental: devolvemos la fila idéntica más reciente sin
    -- tocar reserva_consumos ni movimientos_stock. El stock ya fue
    -- descontado UNA sola vez por la inserción legítima anterior.
    RETURN v_consumo;
  END IF;

  -- Calcular stock bajo el lock.
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION
      'Stock insuficiente de "%": hay % unidades, querés cargar %.',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- INSERT del consumo con snapshots + tipo_reparto + línea.
  -- El snapshot de `linea` se MANTIENE (introducido en 0025): sirve
  -- para el EERR (saber si lo cargado al turno fue buffet o shop).
  -- Ahora la línea snapshot puede ser 'buffet' O 'shop' (antes de la
  -- 0026 siempre era 'buffet' por el check removido; ahora refleja
  -- la línea real del producto).
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto,
    linea
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    p_tipo_reparto,
    v_producto.linea
  )
  RETURNING * INTO v_consumo;

  -- INSERT movimiento de salida atado al consumo nuevo (sin cambios).
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_turno',
    NULL, v_consumo.id, v_usuario_id
  );

  RETURN v_consumo;
END;
$$;


COMMIT;

-- ============================================================================
-- Fin de la migración 0053_consumo_turno_debounce.sql
-- ============================================================================
