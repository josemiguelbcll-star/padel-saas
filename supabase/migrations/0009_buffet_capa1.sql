-- ============================================================================
-- 0009_buffet_capa1.sql
-- Buffet — Capa 1 (punto de venta)
--
-- Esta migración estrena el módulo Buffet con 4 tablas + 1 vista +
-- 1 trigger + 2 RPCs:
--
--   Tablas:
--     - productos               ABM de productos vendibles (admin)
--     - ventas                  cabecera de una venta de mostrador
--     - venta_items             líneas (con snapshots de nombre y precio)
--     - movimientos_stock       libro de inventario (entradas/salidas)
--
--   Vista:
--     - vw_productos_con_stock  productos + stock_actual = SUM(movimientos)
--
--   Trigger:
--     - trg_productos_no_borrar_con_movimientos  bloquea DELETE con mensaje
--
--   RPCs:
--     - fn_registrar_movimiento_stock  carga manual de inventario (admin)
--     - fn_cerrar_venta                venta atómica (header + items + mov)
--
-- Decisiones de modelo:
--   - El stock NO es un escalar; es la SUMA de movimientos por producto.
--     Cada movimiento tiene una `fuente` que documenta su origen
--     ('compra_manual', 'venta', 'ajuste', 'compra_bot_whatsapp'). El bot
--     futuro suma una fuente más sin migración destructiva.
--   - venta_items guarda SNAPSHOTS de nombre y precio: si el producto
--     cambia o se borra después, el histórico de venta sigue siendo fiel
--     a lo que efectivamente se cobró (base para facturación futura).
--   - ventas tiene 3 columnas `comprobante_*` en NULL (fiscal a futuro);
--     la Capa 1 no las toca, la sumatoria contable las llena después
--     sin migrar datos.
--   - CHECK estricto en movimientos_stock que ata (fuente, signo, venta_id):
--     impide que un INSERT mal armado deje el inventario incoherente.
--   - FK ON DELETE RESTRICT en producto_id de movimientos_stock y de
--     venta_items: si el producto tiene historial, no se puede borrar;
--     un trigger con mensaje accionable sugiere desactivarlo.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). No toca ningún
-- módulo existente (reservas, clases, cobros).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: productos
-- ============================================================================
CREATE TABLE productos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(120) NOT NULL,
  categoria VARCHAR(20) NOT NULL
    CHECK (categoria IN ('bebida','snack','otro')),
  precio DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
  /**
   * Umbral de stock para alerta visual "stock bajo" en la pantalla de
   * productos. Default 0 = sin alerta (alerta sólo cuando explícitamente
   * el admin lo configure mayor a 0).
   */
  stock_minimo INT NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidad case-insensitive del nombre dentro del club (evita "Coca" y
-- "coca" como dos productos distintos). UNIQUE funcional → índice aparte.
CREATE UNIQUE INDEX productos_unique_nombre_por_club
  ON productos (club_id, lower(nombre));

CREATE INDEX idx_productos_club_categoria ON productos (club_id, categoria);
CREATE INDEX idx_productos_club_activo ON productos (club_id) WHERE activo;

COMMENT ON TABLE productos IS
  'Catálogo del buffet. ABM administrado por admin. El stock NO vive acá
   (es la suma de movimientos_stock); usar vw_productos_con_stock para
   obtener productos + stock en una sola query.';


-- ============================================================================
-- 2. TABLA: ventas
--    Cabecera. El detalle vive en venta_items.
--    Los campos comprobante_* arrancan NULL — preparados para la Capa
--    fiscal/contable futura sin migración destructiva.
-- ============================================================================
CREATE TABLE ventas (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  monto_total DECIMAL(12,2) NOT NULL CHECK (monto_total >= 0),
  medio_pago VARCHAR(20) NOT NULL
    CHECK (medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro')),
  observaciones TEXT,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Reservado para la Capa fiscal/contable. NULL = venta interna sin
  -- comprobante emitido. Cuando se conecte facturación, estos se llenan
  -- vía UPDATE; no requieren NOT NULL ahora.
  comprobante_tipo VARCHAR(10),
  comprobante_numero VARCHAR(20),
  comprobante_fecha DATE
);

CREATE INDEX idx_ventas_club_fecha ON ventas (club_id, fecha_hora);

COMMENT ON TABLE ventas IS
  'Cabecera de una venta del buffet. Inmutable desde la UI en Capa 1
   (anulación queda pendiente — ver CLAUDE.md). monto_total es snapshot
   al cierre; coincide con SUM(venta_items.subtotal).';

COMMENT ON COLUMN ventas.comprobante_tipo IS
  'Reservado para integración fiscal futura. Capa 1 lo deja NULL.';


-- ============================================================================
-- 3. TABLA: venta_items
--    Líneas de la venta. Guarda snapshots de producto_nombre y
--    precio_unitario: el histórico no depende del catálogo vivo.
-- ============================================================================
CREATE TABLE venta_items (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  venta_id BIGINT NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
  producto_id BIGINT NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  producto_nombre VARCHAR(120) NOT NULL,
  cantidad INT NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(12,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0)
);

CREATE INDEX idx_venta_items_venta ON venta_items (venta_id);
CREATE INDEX idx_venta_items_producto ON venta_items (producto_id);

COMMENT ON COLUMN venta_items.producto_nombre IS
  'Snapshot al momento de la venta. Si el producto se renombra o se
   borra después, el item refleja lo que efectivamente se cobró.';

COMMENT ON COLUMN venta_items.precio_unitario IS
  'Snapshot al momento de la venta. Si el precio del producto cambia
   después, el item conserva el precio cobrado.';


-- ============================================================================
-- 4. TABLA: movimientos_stock
--    Libro mayor del inventario. Stock actual = SUM(cantidad) por producto.
--
--    CHECK estricto fuente ↔ signo ↔ venta_id:
--      - venta             cantidad<0 (salida) AND venta_id IS NOT NULL
--      - compra_manual     cantidad>0 (entrada) AND venta_id IS NULL
--      - compra_bot_whatsapp  cantidad>0 (entrada) AND venta_id IS NULL
--      - ajuste            signo libre AND venta_id IS NULL
--
--    El CHECK previene que un INSERT mal armado (ej. fuente='venta' con
--    cantidad positiva) deje el inventario incoherente. La RPC
--    fn_cerrar_venta produce los inserts correctos por construcción.
-- ============================================================================
CREATE TABLE movimientos_stock (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  producto_id BIGINT NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad INT NOT NULL CHECK (cantidad <> 0),
  fuente VARCHAR(30) NOT NULL
    CHECK (fuente IN ('compra_manual','venta','ajuste','compra_bot_whatsapp')),
  venta_id BIGINT REFERENCES ventas(id) ON DELETE RESTRICT,
  observaciones TEXT,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mov_stock_coherencia_fuente CHECK (
    (fuente = 'venta'
       AND cantidad < 0
       AND venta_id IS NOT NULL)
    OR (fuente IN ('compra_manual','compra_bot_whatsapp')
       AND cantidad > 0
       AND venta_id IS NULL)
    OR (fuente = 'ajuste'
       AND venta_id IS NULL)
  )
);

CREATE INDEX idx_mov_stock_producto ON movimientos_stock (producto_id);
CREATE INDEX idx_mov_stock_club_fecha ON movimientos_stock (club_id, fecha_hora);
CREATE INDEX idx_mov_stock_venta ON movimientos_stock (venta_id)
  WHERE venta_id IS NOT NULL;

COMMENT ON TABLE movimientos_stock IS
  'Libro mayor del inventario. El stock actual de un producto es la
   suma de la columna cantidad sobre todas sus filas. Inmutable salvo
   por admin (RLS). Las ventas insertan filas negativas con
   fuente=''venta'' y venta_id; las cargas manuales insertan positivas
   con fuente=''compra_manual'' vía fn_registrar_movimiento_stock.';

COMMENT ON COLUMN movimientos_stock.fuente IS
  'Origen del movimiento. ''compra_bot_whatsapp'' está reservado para
   la integración futura con el bot de carga de facturas — la Capa 1
   no la emite, pero el CHECK lo acepta para que sumar el bot sea
   aditivo (no requiere migración).';


-- ============================================================================
-- 5. GRANTs sobre tablas y secuencias (RLS filtra abajo)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON productos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ventas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON venta_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON movimientos_stock TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE productos_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE ventas_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE venta_items_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE movimientos_stock_id_seq TO authenticated;


-- ============================================================================
-- 6. RLS — productos (config: admin para mutar)
-- ============================================================================
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "productos_select"
ON productos FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "productos_insert_solo_admin"
ON productos FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "productos_update_solo_admin"
ON productos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "productos_delete_solo_admin"
ON productos FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 7. RLS — ventas (operación: vendedor inserta; admin corrige)
-- ============================================================================
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ventas_select"
ON ventas FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "ventas_insert"
ON ventas FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "ventas_update_solo_admin"
ON ventas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "ventas_delete_solo_admin"
ON ventas FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 8. RLS — venta_items (mismas reglas que ventas)
-- ============================================================================
ALTER TABLE venta_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venta_items_select"
ON venta_items FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "venta_items_insert"
ON venta_items FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "venta_items_update_solo_admin"
ON venta_items FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "venta_items_delete_solo_admin"
ON venta_items FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 9. RLS — movimientos_stock (SELECT+INSERT abiertos; UPDATE+DELETE admin)
-- ============================================================================
ALTER TABLE movimientos_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mov_stock_select"
ON movimientos_stock FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "mov_stock_insert"
ON movimientos_stock FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "mov_stock_update_solo_admin"
ON movimientos_stock FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "mov_stock_delete_solo_admin"
ON movimientos_stock FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 10. VISTA: vw_productos_con_stock
--     Joina productos con la suma de sus movimientos. `security_invoker`
--     propaga las RLS de las tablas subyacentes (el usuario sólo ve los
--     productos de su club, y la suma se hace sobre sus movimientos).
-- ============================================================================
CREATE VIEW vw_productos_con_stock
WITH (security_invoker = true)
AS
SELECT
  p.*,
  COALESCE(SUM(m.cantidad), 0)::INT AS stock_actual
FROM productos p
LEFT JOIN movimientos_stock m ON m.producto_id = p.id
GROUP BY p.id;

GRANT SELECT ON vw_productos_con_stock TO authenticated;

COMMENT ON VIEW vw_productos_con_stock IS
  'Productos + stock_actual (suma de movimientos). Usar esta vista en
   listados (Configuración → Productos y catálogo del buffet) para
   evitar N+1 queries. security_invoker=true asegura que las RLS de
   productos y movimientos_stock aplican al usuario consultante.';


-- ============================================================================
-- 11. Trigger: bloquear DELETE de un producto con movimientos
--
--     FK RESTRICT ya lo bloquearía con SQLSTATE 23503 (mensaje genérico).
--     Este trigger BEFORE DELETE corre primero y tira un RAISE EXCEPTION
--     en castellano con la acción correcta. Mismo patrón que el de
--     clases ↔ clase_cobros (migración 0007).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_check_producto_sin_movimientos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM movimientos_stock WHERE producto_id = OLD.id) THEN
    RAISE EXCEPTION
      'No se puede borrar el producto porque tiene movimientos de stock registrados. Desactivalo en su lugar (campo "Activo" en off).';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION fn_check_producto_sin_movimientos IS
  'Trigger BEFORE DELETE en productos. Rechaza el borrado si hay
   movimientos asociados, con mensaje accionable que sugiere desactivar
   el producto.';

CREATE TRIGGER trg_productos_no_borrar_con_movimientos
BEFORE DELETE ON productos
FOR EACH ROW EXECUTE FUNCTION fn_check_producto_sin_movimientos();


-- ============================================================================
-- 12. RPC: fn_registrar_movimiento_stock
--
--     Carga manual de stock (entrada). Punto controlado para garantizar
--     que toda entrada de inventario manual pase con fuente='compra_manual'
--     y signo positivo. El bot futuro va a sumar su propia RPC con
--     fuente='compra_bot_whatsapp'; los ajustes (entradas/salidas
--     extraordinarias) los manejará otra RPC futura para preservar el
--     mismo principio: nadie INSERTea movimientos sueltos desde el cliente.
--
--     Inputs:
--       p_producto_id      Producto al que se le suma stock.
--       p_cantidad         INT > 0 (entrada).
--       p_observaciones    Texto libre opcional.
--
--     Mensajes (P0001 → dbErrors pasan directo):
--       - 'No hay sesión activa.'
--       - 'La cantidad a cargar debe ser mayor a 0.'
--       - 'El producto no existe o no pertenece a tu club.'
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_registrar_movimiento_stock(
  p_producto_id BIGINT,
  p_cantidad INT,
  p_observaciones TEXT
)
RETURNS movimientos_stock
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_mov movimientos_stock;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a cargar debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente, venta_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, p_cantidad, 'compra_manual', NULL, p_observaciones, v_usuario_id
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;

COMMENT ON FUNCTION fn_registrar_movimiento_stock IS
  'Carga manual de stock (entrada). Inserta un movimiento con
   fuente=''compra_manual'' y signo positivo. Punto centralizado para
   coherencia del inventario.';

GRANT EXECUTE ON FUNCTION fn_registrar_movimiento_stock(
  BIGINT, INT, TEXT
) TO authenticated;


-- ============================================================================
-- 13. RPC: fn_cerrar_venta
--
--     Atómica (regla CLAUDE.md nº 6). En una sola transacción:
--       1. Valida session, items, medio_pago.
--       2. Consolida ítems duplicados por producto_id (suma cantidades).
--       3. SELECT FOR UPDATE de los productos involucrados EN ORDEN
--          ASCENDENTE de id — evita deadlocks entre cierres concurrentes
--          que compitan por los mismos productos en orden distinto.
--       4. Para cada producto: verifica que pertenezca al club, esté
--          activo, y que stock_actual >= cantidad pedida. Acumula total
--          usando precio vigente.
--       5. INSERT en ventas (header).
--       6. INSERT en venta_items con snapshots de nombre y precio.
--       7. INSERT en movimientos_stock (fuente='venta', cantidad negativa,
--          venta_id apuntando al header).
--       8. RETURN la venta insertada.
--
--     Inputs:
--       p_items          JSONB array de {producto_id: BIGINT, cantidad: INT}.
--       p_medio_pago     'efectivo'/'transferencia'/'mp'/'tarjeta'/'otro'.
--       p_observaciones  Texto libre opcional.
--
--     Mensajes (P0001 → dbErrors pasan directo):
--       - 'No hay sesión activa.'
--       - 'La venta tiene que tener al menos un producto.'
--       - 'El medio de pago es obligatorio.'
--       - 'Medio de pago inválido.'
--       - 'La cantidad debe ser mayor a 0.'
--       - 'El producto seleccionado no existe o no pertenece a tu club.'
--       - 'El producto "X" está desactivado, no se puede vender.'
--       - 'Stock insuficiente de "X": hay Y unidades, querés vender Z.'
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cerrar_venta(
  p_items JSONB,
  p_medio_pago VARCHAR,
  p_observaciones TEXT
)
RETURNS ventas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_venta ventas;
  v_producto productos;
  v_stock INT;
  v_total DECIMAL(12,2) := 0;
  v_pids BIGINT[];
  v_cants INT[];
  v_i INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta tiene que tener al menos un producto.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  IF p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- Consolidar ítems duplicados por producto_id. Si el frontend manda
  -- el mismo producto en dos entradas distintas (no debería en uso
  -- normal), sumamos las cantidades para validar stock contra el total
  -- pedido y para generar UN solo venta_item + UN solo movimiento.
  -- Orden ASC por producto_id en arrays paralelos: condición para el
  -- lock determinístico de la sección siguiente.
  SELECT
    array_agg(producto_id ORDER BY producto_id),
    array_agg(cantidad ORDER BY producto_id)
  INTO v_pids, v_cants
  FROM (
    SELECT
      (x->>'producto_id')::BIGINT AS producto_id,
      SUM((x->>'cantidad')::INT)::INT AS cantidad
    FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT
  ) c;

  -- Validar cantidades > 0 (post-consolidación: si alguien manda
  -- cantidades negativas que se cancelan, queremos rechazar).
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    IF v_cants[v_i] IS NULL OR v_cants[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
    END IF;
  END LOOP;

  -- Lock exclusivo de los productos involucrados, en orden ASC de id.
  -- Esto serializa cierres concurrentes que toquen los mismos productos
  -- y previene deadlocks por orden de adquisición distinto. PERFORM
  -- ejecuta el SELECT y descarta resultados; el lock se acquiere igual.
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- Validar cada producto + acumular total. Bajo el lock anterior, el
  -- stock no puede cambiar entre el SELECT y los inserts posteriores.
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto seleccionado no existe o no pertenece a tu club.';
    END IF;

    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
    END IF;

    SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
    FROM movimientos_stock
    WHERE producto_id = v_producto.id;

    IF v_stock < v_cants[v_i] THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": hay % unidades, querés vender %.',
        v_producto.nombre, v_stock, v_cants[v_i];
    END IF;

    v_total := v_total + (v_producto.precio * v_cants[v_i]);
  END LOOP;

  -- Header de la venta.
  INSERT INTO ventas (club_id, monto_total, medio_pago, observaciones, usuario_id)
  VALUES (v_club_id, v_total, p_medio_pago, p_observaciones, v_usuario_id)
  RETURNING * INTO v_venta;

  -- Items + movimientos. Misma iteración orden-determinístico.
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    INSERT INTO venta_items (
      club_id, venta_id, producto_id, producto_nombre, cantidad, precio_unitario, subtotal
    ) VALUES (
      v_club_id, v_venta.id, v_producto.id, v_producto.nombre,
      v_cants[v_i], v_producto.precio, v_producto.precio * v_cants[v_i]
    );

    INSERT INTO movimientos_stock (
      club_id, producto_id, cantidad, fuente, venta_id, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, -v_cants[v_i], 'venta', v_venta.id, v_usuario_id
    );
  END LOOP;

  RETURN v_venta;
END;
$$;

COMMENT ON FUNCTION fn_cerrar_venta IS
  'Cierre atómico de venta del buffet. INSERT en ventas + venta_items
   + movimientos_stock (salida fuente=''venta'') en una sola transacción
   con SELECT FOR UPDATE por producto en orden ASC para evitar oversold
   concurrente y deadlocks. Valida stock, producto activo, pertenencia
   al club y medio de pago. Consolida ítems duplicados por producto_id.';

GRANT EXECUTE ON FUNCTION fn_cerrar_venta(
  JSONB, VARCHAR, TEXT
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0009_buffet_capa1.sql
-- ============================================================================
