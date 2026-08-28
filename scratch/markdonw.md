## Table `clubes`

Tenants del sistema. Cada club opera como una organizaci├│n aislada.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `nombre` | `varchar` |  |
| `slug` | `varchar` |  Unique |
| `direccion` | `varchar` |  Nullable |
| `ciudad` | `varchar` |  Nullable |
| `provincia` | `varchar` |  Nullable |
| `telefono` | `varchar` |  Nullable |
| `email` | `varchar` |  Nullable |
| `plan` | `varchar` |  |
| `activo` | `bool` |  |
| `fecha_alta` | `timestamptz` |  |
| `config` | `jsonb` |  |
| `hora_apertura` | `time` |  Nullable |
| `hora_cierre` | `time` |  Nullable |
| `duracion_turno_default` | `int4` |  |
| `color_primario_hsl` | `varchar` |  |
| `logo_path` | `varchar` |  Nullable |
| `plan_id` | `int8` |  |
| `estado` | `varchar` |  |
| `modalidad_caja` | `varchar` |  |
| `condicion_fiscal` | `varchar` |  |
| `descripcion` | `text` |  Nullable |
| `lat` | `float8` |  Nullable |
| `lng` | `float8` |  Nullable |
| `instagram` | `text` |  Nullable |
| `website` | `text` |  Nullable |
| `perfil_publico_activo` | `bool` |  |
| `cbu_alias` | `text` |  Nullable |
| `nombre_banco` | `text` |  Nullable |
| `sena_porcentaje` | `int4` |  |

## Table `usuarios`

Datos extendidos del usuario, complementa auth.users.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `rol` | `varchar` |  |
| `activo` | `bool` |  |
| `fecha_alta` | `timestamptz` |  |
| `email` | `varchar` |  Nullable |
| `permisos` | `jsonb` |  |

## Table `canchas`

Canchas del club. Configurables por el admin (ABM); el vendedor s├│lo
   las lee. La columna `orden` define el orden de aparici├│n en la grilla.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `tipo` | `varchar` |  Nullable |
| `cubierta` | `bool` |  |
| `activa` | `bool` |  |
| `orden` | `int4` |  |

## Table `tarifas`

Tarifas configurables por el admin. Pueden ser ├║nicas (todo NULL) o
   por franja + d├¡a con prioridad para resolver superposiciones.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `monto` | `numeric` |  |
| `desde_hora` | `time` |  Nullable |
| `hasta_hora` | `time` |  Nullable |
| `dias_semana` | `_int4` |  Nullable |
| `prioridad` | `int4` |  |
| `activa` | `bool` |  |
| `vigente_desde` | `date` |  |
| `vigente_hasta` | `date` |  Nullable |
| `lineage_id` | `int8` |  |
| `duracion_min` | `int4` |  Nullable |

## Table `jugadores`

Jugadores del club. S├│lo nombre obligatorio; el resto se completa con el uso.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `telefono` | `varchar` |  Nullable |
| `email` | `varchar` |  Nullable |
| `nivel` | `varchar` |  Nullable |
| `notas` | `text` |  Nullable |
| `fecha_alta` | `timestamptz` |  |
| `activo` | `bool` |  |
| `genero` | `varchar` |  Nullable |
| `categoria` | `varchar` |  Nullable |
| `posicion` | `varchar` |  Nullable |
| `limite_credito` | `numeric` |  |

## Table `reservas`

Reservas de canchas. Las columnas escalares (monto_*, estado) son el
   resumen para la grilla; el detalle de cobros vive en reserva_pagos.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `cancha_id` | `int8` |  |
| `jugador_id` | `int8` |  Nullable |
| `fecha` | `date` |  |
| `hora_inicio` | `time` |  |
| `hora_fin` | `time` |  |
| `duracion_min` | `int4` |  |
| `tarifa_id` | `int8` |  Nullable |
| `monto_total` | `numeric` |  |
| `monto_sena` | `numeric` |  |
| `monto_pagado` | `numeric` |  |
| `estado` | `varchar` |  |
| `observaciones` | `text` |  Nullable |
| `usuario_alta_id` | `uuid` |  Nullable |
| `fecha_alta` | `timestamptz` |  |
| `turno_fijo_id` | `int8` |  Nullable |
| `cerrado_en` | `timestamptz` |  Nullable |

## Table `reserva_jugadores`

Personas vinculadas a una reserva. Dos tipos (columna `tipo` desde 0012):

   - jugador: pesa para la divisi├│n del alquiler (paso 3 del m├│dulo
     cuenta del turno). Puede tener jugador_id (vinculado a ficha),
     nombre_libre (escrito sin ficha), o ambos null (an├│nimo "Jugador N",
     N derivado del orden de id en la UI). El titular es siempre
     tipo=jugador con es_titular=true.

   - invitado: no juega (no pesa para la divisi├│n); solo consume.
     Estrictamente an├│nimo: jugador_id NULL, nombre_libre NULL,
     es_titular FALSE. La UI lo numera "Invitado N" por orden de id.

   La numeraci├│n "Jugador N" / "Invitado N" es visual (client-side),
   no se persiste. Los IDs en DB son estables ÔÇö sirven para atar pagos
   por persona en el paso 4 del m├│dulo sin romperse cuando la UI
   renumera al borrar uno del medio.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `reserva_id` | `int8` |  |
| `jugador_id` | `int8` |  Nullable |
| `nombre_libre` | `varchar` |  Nullable |
| `es_titular` | `bool` |  |
| `tipo` | `varchar` |  |

## Table `reserva_pagos`

Historial de cobros/se├▒as/reembolsos por reserva. Append-friendly: el
   camino est├índar para revertir un cobro es agregar un reembolso, no
   editar la fila original.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `reserva_id` | `int8` |  |
| `monto` | `numeric` |  |
| `medio_pago` | `varchar` |  |
| `tipo` | `varchar` |  |
| `jugador_id` | `int8` |  Nullable |
| `observaciones` | `text` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |
| `reserva_jugador_id` | `int8` |  Nullable |
| `monto_alquiler` | `numeric` |  |
| `monto_consumo` | `numeric` |  |
| `turno_caja_id` | `int8` |  Nullable |
| `cuenta_id` | `int8` |  Nullable |
| `redondeo` | `numeric` |  |

## Table `profesores`

Profesores del club. Listado configurable por el admin; usados como
   referencia desde clases. NO son usuarios del sistema.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `telefono` | `varchar` |  Nullable |
| `email` | `varchar` |  Nullable |
| `notas` | `text` |  Nullable |
| `activo` | `bool` |  |
| `fecha_alta` | `timestamptz` |  |

## Table `clases`

Bloques r├¡gidos recurrentes semanales (profesor + cancha + d├¡a(s) +
   hora + duraci├│n + precio). Aparecen pre-marcados en la grilla, no
   son reservables por el vendedor.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `profesor_id` | `int8` |  |
| `cancha_id` | `int8` |  |
| `nombre` | `varchar` |  Nullable |
| `dias_semana` | `_int4` |  |
| `hora_inicio` | `time` |  |
| `duracion_min` | `int4` |  |
| `precio` | `numeric` |  |
| `activa` | `bool` |  |
| `fecha_alta` | `timestamptz` |  |
| `es_recurrente` | `bool` |  |
| `fecha_clase` | `date` |  Nullable |

## Table `clase_cobros`

Registro de cobros de clases por ocurrencia (clase + fecha puntual).
   Una ocurrencia puede tener cero, uno o varios pagos: el total cobrado
   es la suma de los montos. La UNIQUE (clase_id, fecha) original fue
   dropeada en la migraci├│n 0008.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `clase_id` | `int8` |  |
| `fecha` | `date` |  |
| `monto` | `numeric` |  |
| `medio_pago` | `varchar` |  |
| `observaciones` | `text` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |
| `turno_caja_id` | `int8` |  Nullable |
| `cuenta_id` | `int8` |  Nullable |

## Table `productos`

Cat├ílogo del buffet. ABM administrado por admin. El stock NO vive ac├í
   (es la suma de movimientos_stock); usar vw_productos_con_stock para
   obtener productos + stock en una sola query.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `categoria` | `varchar` |  |
| `precio` | `numeric` |  |
| `stock_minimo` | `int4` |  |
| `activo` | `bool` |  |
| `fecha_alta` | `timestamptz` |  |
| `costo` | `numeric` |  Nullable |
| `linea` | `varchar` |  |

## Table `ventas`

Cabecera de una venta del buffet. Inmutable desde la UI en Capa 1
   (anulaci├│n queda pendiente ÔÇö ver CLAUDE.md). monto_total es snapshot
   al cierre; coincide con SUM(venta_items.subtotal).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `monto_total` | `numeric` |  |
| `medio_pago` | `varchar` |  |
| `observaciones` | `text` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |
| `comprobante_tipo` | `varchar` |  Nullable |
| `comprobante_numero` | `varchar` |  Nullable |
| `comprobante_fecha` | `date` |  Nullable |
| `turno_caja_id` | `int8` |  Nullable |
| `cuenta_id` | `int8` |  Nullable |
| `jugador_id` | `int8` |  Nullable |

## Table `venta_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `venta_id` | `int8` |  |
| `producto_id` | `int8` |  |
| `producto_nombre` | `varchar` |  |
| `cantidad` | `int4` |  |
| `precio_unitario` | `numeric` |  |
| `subtotal` | `numeric` |  |
| `costo_unitario` | `numeric` |  Nullable |
| `linea` | `varchar` |  |

## Table `movimientos_stock`

Libro mayor del inventario. El stock actual de un producto es la
   suma de la columna cantidad sobre todas sus filas. Inmutable salvo
   por admin (RLS). Las ventas insertan filas negativas con
   fuente='venta' y venta_id; las cargas manuales insertan positivas
   con fuente='compra_manual' v├¡a fn_registrar_movimiento_stock.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `producto_id` | `int8` |  |
| `cantidad` | `int4` |  |
| `fuente` | `varchar` |  |
| `venta_id` | `int8` |  Nullable |
| `observaciones` | `text` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |
| `reserva_consumo_id` | `int8` |  Nullable |
| `compra_id` | `int8` |  Nullable |

## Table `reserva_consumos`

Consumos de buffet cargados a una reserva (cuenta del turno tipo
   restaurante). Cada fila representa un producto vendido como parte de
   la cuenta del turno (NO de una venta de mostrador ÔÇö esa va en
   ventas/venta_items).

   Cada consumo dispara un movimiento de stock fuente=consumo_turno
   apuntado v├¡a movimientos_stock.reserva_consumo_id. Si el consumo se
   quita (fn_quitar_consumo_turno):
     1. Se inserta un movimiento fuente=reposicion_consumo (positivo)
        que devuelve el producto al inventario.
     2. Se borra la fila de reserva_consumos. El FK ON DELETE SET NULL
        deja el movimiento de salida original con reserva_consumo_id=
        NULL ÔÇö queda como evidencia hist├│rica del libro (NO se borra,
        preserva la auditabilidad de movimientos_stock).

   Snapshots de nombre/precio/costo al cargar ÔÇö el total del turno y
   los reportes de margen son fieles aunque el producto cambie
   despu├®s.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `reserva_id` | `int8` |  |
| `producto_id` | `int8` |  |
| `producto_nombre` | `varchar` |  |
| `precio_unitario` | `numeric` |  |
| `costo_unitario` | `numeric` |  Nullable |
| `cantidad` | `int4` |  |
| `subtotal` | `numeric` |  |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |
| `tipo_reparto` | `varchar` |  |
| `linea` | `varchar` |  |

## Table `plataforma_admins`

Superadmins de la plataforma (due├▒o/equipo del SaaS). Vive aparte
   de `usuarios` para que el invariante multi-tenant "todo usuario
   tiene un club" no se rompa, y para que sea ESTRUCTURALMENTE
   imposible escalar de admin de club a superadmin (requiere INSERT
   en esta tabla, bloqueado para authenticated). Alta exclusiva por
   service_role (Studio o Edge Function dedicada).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `nombre` | `varchar` |  |
| `email` | `varchar` |  |
| `activo` | `bool` |  |
| `fecha_alta` | `timestamptz` |  |
| `notas` | `text` |  Nullable |

## Table `modulos`

Cat├ílogo de m├│dulos del sistema (reservas, buffet, clases, etc.).
   `codigo` es el identificador estable usado en c├│digo (frontend y
   helper current_club_has_modulo). `activo=false` deshabilita el
   m├│dulo globalmente (no aparece en ning├║n plan); ├║til para deprecar
   m├│dulos sin borrarlos.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `codigo` | `varchar` |  Unique |
| `nombre` | `varchar` |  |
| `descripcion` | `text` |  Nullable |
| `orden` | `int4` |  |
| `activo` | `bool` |  |

## Table `planes`

Cat├ílogo de planes del SaaS (basico, intermedio, pro, ÔÇª).
   `codigo` es el identificador estable referenciado en backfills y
   c├│digo. `precio_mensual` queda en 0 hasta que se defina pricing
   real. `activo=false` no permite asignar nuevos clubes a ese plan
   (clubes existentes siguen ÔÇö la baja de un plan se gestiona migrando
   los clubes a otro).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `codigo` | `varchar` |  Unique |
| `nombre` | `varchar` |  |
| `descripcion` | `text` |  Nullable |
| `precio_mensual` | `numeric` |  |
| `orden` | `int4` |  |
| `activo` | `bool` |  |

## Table `plan_modulos`

Many-to-many entre planes y m├│dulos. Cambiar qu├® m├│dulos incluye
   un plan = UPDATE ac├í, sin tocar c├│digo. ON DELETE CASCADE sim├®trico
   (si se borra un plan o un m├│dulo, sus relaciones tambi├®n).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `plan_id` | `int8` | Primary |
| `modulo_id` | `int8` | Primary |

## Table `turnos_caja`

Jornadas de caja del club (apertura ÔåÆ cierre con arqueo). En modalidad
   por_dia hay una sola caja abierta por club; en por_vendedor, una por
   (club, vendedor). Los cobros en efectivo se atan v├¡a
   reserva_pagos/ventas/clase_cobros.turno_caja_id en la 0023.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `fecha_jornada` | `date` |  |
| `monto_apertura` | `numeric` |  |
| `usuario_apertura` | `uuid` |  |
| `abierta_en` | `timestamptz` |  |
| `modalidad` | `varchar` |  |
| `vendedor_id` | `uuid` |  Nullable |
| `cerrada_en` | `timestamptz` |  Nullable |
| `usuario_cierre` | `uuid` |  Nullable |
| `efectivo_esperado` | `numeric` |  Nullable |
| `efectivo_contado` | `numeric` |  Nullable |
| `diferencia` | `numeric` |  Nullable |
| `observaciones_cierre` | `text` |  Nullable |

## Table `caja_movimientos_manuales`

Salidas/ajustes manuales sobre una caja abierta. Inmutables ÔÇö corregir
   = registrar movimiento compensatorio (auditabilidad).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `turno_caja_id` | `int8` |  |
| `tipo` | `varchar` |  |
| `monto` | `numeric` |  |
| `concepto` | `varchar` |  |
| `observaciones` | `text` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |

## Table `unidades_negocio`

Unidades de negocio del club. Determinan el agrupamiento del EERR.
   Tipo enum cerrado; cuando emerja una unidad nueva (ej. estacionamiento),
   se agrega v├¡a migraci├│n.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `tipo` | `varchar` |  |
| `activa` | `bool` |  |
| `orden` | `int4` |  |
| `fecha_alta` | `timestamptz` |  |

## Table `categorias_gasto`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `unidad_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `activa` | `bool` |  |
| `orden` | `int4` |  |
| `fecha_alta` | `timestamptz` |  |
| `es_mercaderia` | `bool` |  |
| `clasificacion` | `varchar` |  Nullable |

## Table `gastos`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `categoria_id` | `int8` |  |
| `categoria_nombre` | `varchar` |  |
| `unidad_id` | `int8` |  |
| `unidad_nombre` | `varchar` |  |
| `unidad_tipo` | `varchar` |  |
| `monto` | `numeric` |  |
| `fecha_gasto` | `date` |  |
| `fecha_pago` | `date` |  Nullable |
| `medio_pago` | `varchar` |  Nullable |
| `turno_caja_id` | `int8` |  Nullable |
| `proveedor` | `varchar` |  Nullable |
| `observaciones` | `text` |  Nullable |
| `activo` | `bool` |  |
| `usuario_id` | `uuid` |  |
| `fecha_alta` | `timestamptz` |  |
| `proveedor_id` | `int8` |  Nullable |
| `gasto_recurrente_id` | `int8` |  Nullable |
| `cuenta_id` | `int8` |  Nullable |
| `clasificacion` | `varchar` |  Nullable |

## Table `otros_ingresos`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `unidad_id` | `int8` |  |
| `unidad_nombre` | `varchar` |  |
| `unidad_tipo` | `varchar` |  |
| `concepto` | `varchar` |  |
| `monto` | `numeric` |  |
| `fecha` | `date` |  |
| `fecha_cobro` | `date` |  Nullable |
| `medio_pago` | `varchar` |  Nullable |
| `turno_caja_id` | `int8` |  Nullable |
| `observaciones` | `text` |  Nullable |
| `activo` | `bool` |  |
| `usuario_id` | `uuid` |  |
| `fecha_alta` | `timestamptz` |  |
| `cuenta_id` | `int8` |  Nullable |

## Table `turnos_fijos`

Reservas recurrentes (semanales) con clientes habituales. La grilla
   diaria se llena con reservas materializadas v├¡a fn_materializar_turnos_fijos
   ÔÇö el turno fijo es la definici├│n, las reservas materializadas son
   las instancias concretas (cobrables, cancelables individualmente).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `cancha_id` | `int8` |  |
| `jugador_id` | `int8` |  Nullable |
| `nombre_libre` | `varchar` |  Nullable |
| `dia_semana` | `int4` |  |
| `hora_inicio` | `time` |  |
| `duracion_min` | `int4` |  |
| `fecha_desde` | `date` |  |
| `fecha_hasta` | `date` |  Nullable |
| `activo` | `bool` |  |
| `observaciones` | `text` |  Nullable |
| `usuario_alta_id` | `uuid` |  |
| `fecha_alta` | `timestamptz` |  |

## Table `tarifas_clases`

Tarifas de ALQUILER DE CANCHA para clases. Separadas de la tabla
   `tarifas` (que es para turnos sueltos / turnos fijos). En este club
   el profe cobra a los alumnos directamente; el club solo cobra al
   profe el alquiler de la cancha donde da la clase.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `monto` | `numeric` |  |
| `desde_hora` | `time` |  Nullable |
| `hasta_hora` | `time` |  Nullable |
| `dias_semana` | `_int4` |  Nullable |
| `prioridad` | `int4` |  |
| `activa` | `bool` |  |
| `vigente_desde` | `date` |  |
| `vigente_hasta` | `date` |  Nullable |
| `lineage_id` | `int8` |  |
| `min_alumnos` | `int4` |  |
| `max_alumnos` | `int4` |  Nullable |

## Table `proveedores`

Cat├ílogo de proveedores del club. ABM admin. Datos opcionales
   excepto nombre. Las compras (Nivel B Bloque 2) van a referenciar
   esta tabla ÔÇö cuando exista, sumar trigger anti-DELETE con
   dependencias (mismo patr├│n que productos).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `cuit` | `varchar` |  Nullable |
| `contacto_persona` | `varchar` |  Nullable |
| `contacto_telefono` | `varchar` |  Nullable |
| `contacto_email` | `varchar` |  Nullable |
| `condiciones_pago` | `text` |  Nullable |
| `que_provee` | `text` |  Nullable |
| `notas` | `text` |  Nullable |
| `activo` | `bool` |  |
| `fecha_alta` | `timestamptz` |  |

## Table `compras`

Cabecera de una compra unificada. Bloque 2: solo tipo='compra'
   (genera gasto v├¡a fn_registrar_gasto y aplica PPP a productos.costo).
   tipo='bonificacion' (2.5) y 'consignacion' (futuro) NO generan
   gasto al recibir y, en el caso de consignaci├│n, NO aplican PPP.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `proveedor_id` | `int8` |  |
| `tipo` | `varchar` |  |
| `linea` | `varchar` |  |
| `fecha_oc` | `date` |  |
| `monto_total` | `numeric` |  Nullable |
| `gasto_id` | `int8` |  Nullable |
| `observaciones` | `text` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_alta` | `timestamptz` |  |
| `estado` | `varchar` |  |
| `fecha_recepcion` | `date` |  Nullable |
| `condicion_pago` | `varchar` |  |
| `fecha_compromiso_pago` | `date` |  Nullable |
| `monto_neto_oc` | `numeric` |  |
| `monto_neto` | `numeric` |  Nullable |
| `monto_iva` | `numeric` |  Nullable |
| `comprobante_tipo` | `varchar` |  Nullable |
| `comprobante_numero` | `varchar` |  Nullable |
| `condicion_fiscal_club` | `varchar` |  Nullable |

## Table `compra_items`

L├¡neas de una compra unificada. Snapshots de producto_nombre, costo
   unitario, subtotal y l├¡nea para que el hist├│rico no dependa del
   cat├ílogo vivo (mismo patr├│n que venta_items / reserva_consumos).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `compra_id` | `int8` |  |
| `producto_id` | `int8` |  |
| `producto_nombre` | `varchar` |  |
| `cantidad` | `int4` |  |
| `costo_unitario_compra` | `numeric` |  |
| `subtotal` | `numeric` |  |
| `linea` | `varchar` |  |
| `cantidad_bultos` | `int4` |  |
| `unidades_por_bulto` | `int4` |  |
| `costo_por_bulto` | `numeric` |  |
| `tasa_iva` | `numeric` |  Nullable |
| `subtotal_iva` | `numeric` |  Nullable |
| `subtotal_total` | `numeric` |  Nullable |
| `costo_unitario_ppp` | `numeric` |  Nullable |

## Table `gasto_cuotas`

Plan de pago en cuotas de un gasto pendiente. Una cuota por fila;
   numero=0 es anticipo opcional, numero>=1 son cuotas regulares. El
   estado de la deuda (pendiente/parcial/saldada) se deriva on-the-fly
   sumando cuotas con fecha_pago != NULL. La invariante SUM(monto) =
   gastos.monto la garantizan las RPCs.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `gasto_id` | `int8` |  |
| `numero` | `int4` |  |
| `es_anticipo` | `bool` |  |
| `monto` | `numeric` |  |
| `fecha_vencimiento` | `date` |  Nullable |
| `fecha_pago` | `date` |  Nullable |
| `medio_pago` | `varchar` |  Nullable |
| `turno_caja_id` | `int8` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_alta` | `timestamptz` |  |
| `cuenta_id` | `int8` |  Nullable |

## Table `gastos_recurrentes`

Cat├ílogo de plantillas de gastos recurrentes (alquiler, luz, sueldos).
   Las plantillas NO son movimientos contables; solo el panel
   "Recurrentes del mes" las usa para detectar qu├® falta cargar. El
   gasto real se crea via fn_registrar_gasto vinculado por
   gasto_recurrente_id.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `categoria_id` | `int8` |  |
| `proveedor_id` | `int8` |  Nullable |
| `concepto` | `varchar` |  |
| `monto_estimado` | `numeric` |  |
| `dia_vencimiento` | `int2` |  |
| `frecuencia` | `varchar` |  |
| `observaciones` | `text` |  Nullable |
| `activo` | `bool` |  |
| `usuario_id` | `uuid` |  |
| `fecha_alta` | `timestamptz` |  |

## Table `anulaciones`

Libro append-only de anulaciones (Filosof├¡a B). Una fila por evento:
   FK tipada a lo anulado (gasto / pago de cuota), motivo categorizable +
   detalle, snapshot del estado original (monto, fecha, medio, caja) y
   link al ajuste de caja de hoy si lo hubo. Inmutable (sin UPDATE/DELETE).
   Cimiento reusable: ventas/compras suman su FK tipada + valor de enum.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `entidad_tipo` | `varchar` |  |
| `gasto_id` | `int8` |  Nullable |
| `gasto_cuota_id` | `int8` |  Nullable |
| `motivo_tipo` | `varchar` |  |
| `motivo_detalle` | `text` |  Nullable |
| `monto` | `numeric` |  |
| `fecha_original` | `date` |  Nullable |
| `medio_pago_original` | `varchar` |  Nullable |
| `caja_original_id` | `int8` |  Nullable |
| `caja_original_cerrada` | `bool` |  Nullable |
| `caja_movimiento_id` | `int8` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |

## Table `franjas_turno`

Reglas de duraci├│n de turno por franja horaria + d├¡as (+ cancha
   opcional). Reemplaza a la deprecada franjas_duracion (0004/0005), sin
   versionado temporal. La grilla din├ímica (Forma B) ofrece, en cada
   hueco libre, inicios con las duraciones de la franja aplicable, sin
   cruzar su borde. Sin franja ÔåÆ fallback clubes.duracion_turno_default.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `cancha_id` | `int8` |  Nullable |
| `nombre` | `varchar` |  |
| `desde_hora` | `time` |  Nullable |
| `hasta_hora` | `time` |  Nullable |
| `dias_semana` | `_int4` |  Nullable |
| `duraciones_min` | `_int4` |  |
| `prioridad` | `int4` |  |
| `activa` | `bool` |  |

## Table `cuentas`

Cuentas de tesorer├¡a configurables por club (efectivo, banco, billetera,
   etc.). El medio de pago dice "c├│mo" lleg├│ la plata; la cuenta, "d├│nde"
   est├í. es_caja_fisica marca las que entran al arqueo del caj├│n.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `tipo` | `varchar` |  |
| `es_caja_fisica` | `bool` |  |
| `saldo_inicial` | `numeric` |  |
| `activa` | `bool` |  |
| `orden` | `int4` |  |
| `detalle` | `varchar` |  Nullable |
| `fecha_alta` | `timestamptz` |  |

## Table `medio_cuenta_default`

Cuenta por defecto de cada medio de pago, por club. Ausencia de fila =
   ese medio no tiene default ÔåÆ en Etapa 2 el operador elige la cuenta al
   cobrar. El medio efectivo siempre tiene fila (seed + invariante).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `club_id` | `int8` | Primary |
| `medio_pago` | `varchar` | Primary |
| `cuenta_id` | `int8` |  |

## Table `transferencias`

Movimientos internos de plata entre dos cuentas del club (no es cobro ni
   pago a terceros ÔåÆ sin medio_pago). turno_caja_id se setea solo si una pata
   es es_caja_fisica (mueve efectivo del caj├│n ÔåÆ entra al arqueo). Inmutable:
   corregir = transferencia compensatoria (Filosof├¡a B).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `cuenta_origen_id` | `int8` |  |
| `cuenta_destino_id` | `int8` |  |
| `monto` | `numeric` |  |
| `fecha` | `date` |  |
| `concepto` | `varchar` |  Nullable |
| `observaciones` | `text` |  Nullable |
| `turno_caja_id` | `int8` |  Nullable |
| `usuario_id` | `uuid` |  |
| `fecha_hora` | `timestamptz` |  |

## Table `club_fotos`

Galer�a de fotos del perfil p�blico del club. url = URL p�blica de
   Supabase Storage. es_portada = foto hero del perfil.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `url` | `text` |  |
| `caption` | `text` |  Nullable |
| `orden` | `int2` |  |
| `es_portada` | `bool` |  |
| `created_at` | `timestamptz` |  |

## Table `jugadores_app`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `auth_user_id` | `uuid` |  Nullable Unique |
| `nombre_display` | `text` |  |
| `nombre_corto` | `text` |  |
| `foto_url` | `text` |  Nullable |
| `zona` | `text` |  Nullable |
| `rating` | `int4` |  |
| `partidos_jugados` | `int4` |  |
| `partidos_ganados` | `int4` |  |
| `activo` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `alias` | `text` |  Nullable |
| `telefono` | `text` |  Nullable |
| `genero` | `text` |  Nullable |
| `categoria` | `text` |  Nullable |

## Table `jugador_app_club_link`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `jugador_app_id` | `uuid` | Primary |
| `club_id` | `int8` | Primary |
| `jugador_club_id` | `int8` |  Nullable |
| `vinculado_en` | `timestamptz` |  |
| `confirmado_club` | `bool` |  |

## Table `club_posts`

Feed central: posts de clubes (noticias, promos, torneos). Visible para todos los jugadores autenticados.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `usuario_id` | `uuid` |  |
| `titulo` | `text` |  |
| `contenido` | `text` |  |
| `tipo` | `text` |  |
| `imagen_url` | `text` |  Nullable |
| `activo` | `bool` |  |
| `vigente_desde` | `date` |  Nullable |
| `vigente_hasta` | `date` |  Nullable |
| `creado_en` | `timestamptz` |  |
| `actualizado_en` | `timestamptz` |  |
| `expira_en` | `timestamptz` |  Nullable |
| `badge` | `varchar` |  Nullable |
| `cta_texto` | `varchar` |  Nullable |
| `cta_link` | `varchar` |  Nullable |
| `vistas` | `int4` |  Nullable |
| `reacciones` | `int4` |  Nullable |

## Table `jugador_amigos`

Red de amigos global (cross-club). Vincula dos jugadores_app. Confirmado=false es pending, confirmado=true es mutual.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `jugador_app_id_1` | `uuid` | Primary |
| `jugador_app_id_2` | `uuid` | Primary |
| `confirmado` | `bool` |  |
| `vinculado_en` | `timestamptz` |  |
| `solicitante_id` | `uuid` |  Nullable |

## Table `desafios`

Desafio entre amigos para jugar juntos. Al aceptar, crea reservas para ambos en el mismo slot.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `jugador_app_id_de` | `uuid` |  |
| `jugador_app_id_para` | `uuid` |  |
| `club_id` | `int8` |  |
| `cancha_id` | `int8` |  |
| `fecha` | `date` |  |
| `hora_inicio` | `time` |  |
| `duracion_min` | `int4` |  |
| `mensaje` | `text` |  Nullable |
| `estado` | `text` |  |
| `creado_en` | `timestamptz` |  |
| `respondido_en` | `timestamptz` |  Nullable |
| `reserva_id_de` | `int8` |  Nullable |
| `reserva_id_para` | `int8` |  Nullable |

## Table `promociones`

Promociones por club: descuentos en tarifas y 2x1 en productos. Se aplican al reservar/vender.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `tipo` | `text` |  |
| `nombre` | `text` |  |
| `descripcion` | `text` |  Nullable |
| `tarifa_id` | `int8` |  Nullable |
| `porcentaje_descuento` | `int4` |  Nullable |
| `producto_id` | `int8` |  Nullable |
| `vigente_desde` | `date` |  Nullable |
| `vigente_hasta` | `date` |  Nullable |
| `activo` | `bool` |  |
| `creado_en` | `timestamptz` |  |
| `actualizado_en` | `timestamptz` |  |

## Table `noticias_feed`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `club_id` | `int8` |  |
| `usuario_id` | `uuid` |  Nullable |
| `titulo` | `varchar` |  |
| `descripcion` | `text` |  Nullable |
| `imagen_url` | `varchar` |  Nullable |
| `creado_en` | `timestamptz` |  Nullable |
| `activo` | `bool` |  Nullable |

## Table `club_mercadopago_config`

Almacena de forma segura las credenciales privadas de Mercado Pago para cada club. Protegido por RLS para evitar fugas.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `club_id` | `int8` | Primary |
| `access_token` | `text` |  |
| `public_key` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `titular_nombre` | `text` |  Nullable |
| `cbu` | `text` |  Nullable |
| `alias` | `text` |  Nullable |

## Table `notificaciones`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `jugador_app_id` | `uuid` |  Nullable |
| `titulo` | `varchar` |  Nullable |
| `mensaje` | `text` |  Nullable |
| `leido` | `bool` |  |
| `fecha` | `timestamptz` |  |
| `tipo` | `varchar` |  |
| `metadata` | `jsonb` |  Nullable |
| `club_id` | `int8` |  Nullable |
| `payload` | `jsonb` |  Nullable |
| `target_role` | `varchar` |  Nullable |

## Table `buffet_mesas`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `nombre` | `varchar` |  |
| `abierta` | `bool` |  |
| `creada_at` | `timestamptz` |  |
| `cerrada_at` | `timestamptz` |  Nullable |
| `venta_id` | `int8` |  Nullable |

## Table `buffet_mesa_consumos`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `mesa_id` | `int8` |  |
| `producto_id` | `int8` |  |
| `cantidad` | `int4` |  |
| `creada_at` | `timestamptz` |  |

## Table `jugador_movimientos_cuenta`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `jugador_id` | `int8` |  |
| `monto` | `numeric` |  |
| `concepto` | `varchar` |  |
| `venta_id` | `int8` |  Nullable |
| `reserva_pago_id` | `int8` |  Nullable |
| `creado_at` | `timestamptz` |  |
| `usuario_id` | `uuid` |  |
| `turno_caja_id` | `int8` |  Nullable |

## Table `bloqueos_horario`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `cancha_id` | `int8` |  |
| `fecha` | `date` |  |
| `hora_inicio` | `time` |  |
| `hora_fin` | `time` |  |
| `motivo` | `text` |  |
| `creado_at` | `timestamptz` |  |
| `usuario_id` | `uuid` |  |

## Table `user_pwa_subscriptions`

Almacena las suscripciones Web Push (endpoint y claves criptográficas auth/p256dh) de los usuarios logueados para la PWA de MatchGo.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `endpoint` | `text` | Primary |
| `user_id` | `uuid` |  |
| `keys_auth` | `text` |  |
| `keys_p256dh` | `text` |  |
| `created_at` | `timestamptz` |  Nullable |

## Table `partidos_abiertos`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `reserva_id` | `int8` |  Nullable |
| `organizador_id` | `uuid` |  |
| `categoria` | `varchar` |  |
| `faltan_jugadores` | `int4` |  |
| `posicion_buscada` | `varchar` |  |
| `nota` | `text` |  Nullable |
| `visibilidad` | `varchar` |  |
| `creado_en` | `timestamptz` |  Nullable |
| `club_nombre_manual` | `varchar` |  Nullable |
| `cancha_nombre_manual` | `varchar` |  Nullable |
| `fecha_manual` | `date` |  Nullable |
| `hora_inicio_manual` | `time` |  Nullable |

## Table `partido_participantes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `partido_abierto_id` | `int8` |  |
| `jugador_app_id` | `uuid` |  |
| `confirmado` | `bool` |  |
| `solicitado_by` | `varchar` |  |
| `creado_en` | `timestamptz` |  Nullable |
| `asistio` | `bool` |  Nullable |
| `calificacion_nivel` | `varchar` |  Nullable |

## Table `clase_ocurrencias`

Materialización de una clase en una fecha específica para congelar la cantidad de alumnos y la deuda (monto_total).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `club_id` | `int8` |  |
| `clase_id` | `int8` |  |
| `fecha` | `date` |  |
| `cantidad_alumnos` | `int4` |  |
| `monto_total` | `numeric` |  |
| `estado` | `varchar` |  |
| `creado_por` | `uuid` |  |
| `creado_en` | `timestamptz` |  |

## RLS Policies

### `clubes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `clubes_select` | SELECT | authenticated | PERMISSIVE | `((id = current_club_id()) OR current_user_is_plataforma_admin())` | — |
| `clubes_update_solo_admin_horarios` | UPDATE | authenticated | PERMISSIVE | `((id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `usuarios`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `usuarios_select` | SELECT | authenticated | PERMISSIVE | `((club_id = current_club_id()) OR current_user_is_plataforma_admin())` | — |
| `usuarios_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `canchas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `canchas_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `canchas_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `canchas_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `canchas_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `user_pwa_subscriptions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `user_pwa_subs_delete` | DELETE | authenticated | PERMISSIVE | `(auth.uid() = user_id)` | — |
| `user_pwa_subs_insert` | INSERT | authenticated | PERMISSIVE | — | `(auth.uid() = user_id)` |
| `user_pwa_subs_select` | SELECT | authenticated | PERMISSIVE | `(auth.uid() = user_id)` | — |
| `user_pwa_subs_update` | UPDATE | authenticated | PERMISSIVE | `(auth.uid() = user_id)` | `(auth.uid() = user_id)` |

### `partidos_abiertos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `partidos_abiertos_delete` | DELETE | authenticated | PERMISSIVE | `(organizador_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` | — |
| `partidos_abiertos_insert` | INSERT | authenticated | PERMISSIVE | — | `(organizador_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` |
| `partidos_abiertos_select` | SELECT | authenticated | PERMISSIVE | `true` | — |

### `partido_participantes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `participantes_delete` | DELETE | authenticated | PERMISSIVE | `((partido_abierto_id IN ( SELECT partidos_abiertos.id    FROM partidos_abiertos   WHERE (partidos_abiertos.organizador_id IN ( SELECT jugadores_app.id            FROM jugadores_app           WHERE (jugadores_app.auth_user_id = auth.uid()))))) OR (jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` | — |
| `participantes_insert` | INSERT | authenticated | PERMISSIVE | — | `((partido_abierto_id IN ( SELECT partidos_abiertos.id    FROM partidos_abiertos   WHERE (partidos_abiertos.organizador_id IN ( SELECT jugadores_app.id            FROM jugadores_app           WHERE (jugadores_app.auth_user_id = auth.uid()))))) OR (jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` |
| `participantes_select` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `participantes_update` | UPDATE | authenticated | PERMISSIVE | `((partido_abierto_id IN ( SELECT partidos_abiertos.id    FROM partidos_abiertos   WHERE (partidos_abiertos.organizador_id IN ( SELECT jugadores_app.id            FROM jugadores_app           WHERE (jugadores_app.auth_user_id = auth.uid()))))) OR (jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` | `((partido_abierto_id IN ( SELECT partidos_abiertos.id    FROM partidos_abiertos   WHERE (partidos_abiertos.organizador_id IN ( SELECT jugadores_app.id            FROM jugadores_app           WHERE (jugadores_app.auth_user_id = auth.uid()))))) OR (jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` |

### `reservas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reservas_delete` | DELETE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `reservas_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `reservas_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `reservas_update` | UPDATE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `modulos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `modulos_delete_solo_superadmin` | DELETE | authenticated | PERMISSIVE | `current_user_is_plataforma_admin()` | — |
| `modulos_insert_solo_superadmin` | INSERT | authenticated | PERMISSIVE | — | `current_user_is_plataforma_admin()` |
| `modulos_select` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `modulos_update_solo_superadmin` | UPDATE | authenticated | PERMISSIVE | `current_user_is_plataforma_admin()` | `current_user_is_plataforma_admin()` |

### `jugadores`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `jugadores_delete` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `jugadores_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `jugadores_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `jugadores_update` | UPDATE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `planes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `planes_delete_solo_superadmin` | DELETE | authenticated | PERMISSIVE | `current_user_is_plataforma_admin()` | — |
| `planes_insert_solo_superadmin` | INSERT | authenticated | PERMISSIVE | — | `current_user_is_plataforma_admin()` |
| `planes_select` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `planes_update_solo_superadmin` | UPDATE | authenticated | PERMISSIVE | `current_user_is_plataforma_admin()` | `current_user_is_plataforma_admin()` |

### `reserva_jugadores`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reserva_jugadores_delete` | DELETE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `reserva_jugadores_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `reserva_jugadores_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `reserva_jugadores_update` | UPDATE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `plan_modulos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `plan_modulos_delete_solo_superadmin` | DELETE | authenticated | PERMISSIVE | `current_user_is_plataforma_admin()` | — |
| `plan_modulos_insert_solo_superadmin` | INSERT | authenticated | PERMISSIVE | — | `current_user_is_plataforma_admin()` |
| `plan_modulos_select` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `plan_modulos_update_solo_superadmin` | UPDATE | authenticated | PERMISSIVE | `current_user_is_plataforma_admin()` | `current_user_is_plataforma_admin()` |

### `reserva_consumos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reserva_consumos_delete` | DELETE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `reserva_consumos_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `reserva_consumos_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `reserva_consumos_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `profesores`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `profesores_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `profesores_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `profesores_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `profesores_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `clases`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `clases_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `clases_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `clases_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `clases_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `plataforma_admins`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `plataforma_admins_select` | SELECT | authenticated | PERMISSIVE | `current_user_is_plataforma_admin()` | — |

### `clase_cobros`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `clase_cobros_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `clase_cobros_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `clase_cobros_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `clase_cobros_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `movimientos_stock`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `mov_stock_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `mov_stock_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `mov_stock_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `mov_stock_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `productos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `productos_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `productos_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `productos_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `productos_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `venta_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `venta_items_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `venta_items_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `venta_items_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `venta_items_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `ventas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `ventas_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `ventas_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `ventas_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `ventas_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `turnos_caja`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `turnos_caja_insert_admin_o_vendedor` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |
| `turnos_caja_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `turnos_caja_update_admin_o_vendedor` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |

### `caja_movimientos_manuales`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `caja_mov_man_insert_admin_o_vendedor` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |
| `caja_mov_man_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |

### `reserva_pagos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reserva_pagos_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `reserva_pagos_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `reserva_pagos_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `reserva_pagos_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `tarifas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `tarifas_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `tarifas_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `tarifas_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `tarifas_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `unidades_negocio`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `unidades_negocio_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `unidades_negocio_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `unidades_negocio_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `turnos_fijos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `turnos_fijos_delete_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `turnos_fijos_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `turnos_fijos_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `turnos_fijos_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `otros_ingresos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `otros_ingresos_insert_admin_o_vendedor` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |
| `otros_ingresos_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `otros_ingresos_update_admin_o_vendedor` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |

### `proveedores`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `proveedores_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `proveedores_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `proveedores_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `proveedores_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `tarifas_clases`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `tarifas_clases_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `tarifas_clases_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `tarifas_clases_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `compras`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `compras_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `compras_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `compras_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `clase_ocurrencias`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `clase_ocurrencias_delete` | DELETE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `clase_ocurrencias_insert` | INSERT | authenticated | PERMISSIVE | — | `(club_id = current_club_id())` |
| `clase_ocurrencias_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `clase_ocurrencias_update` | UPDATE | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `compra_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `compra_items_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `compra_items_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |

### `gasto_cuotas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `gasto_cuotas_insert` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |
| `gasto_cuotas_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `gasto_cuotas_update` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |

### `gastos_recurrentes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `gastos_recurrentes_delete_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `gastos_recurrentes_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `gastos_recurrentes_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `gastos_recurrentes_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `anulaciones`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `anulaciones_insert_admin_o_vendedor` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |
| `anulaciones_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |

### `cuentas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cuentas_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `cuentas_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `cuentas_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `medio_cuenta_default`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `medio_cuenta_default_delete_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `medio_cuenta_default_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `medio_cuenta_default_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `medio_cuenta_default_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `franjas_turno`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `franjas_turno_delete_solo_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `franjas_turno_insert_solo_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `franjas_turno_select` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `franjas_turno_update_solo_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `transferencias`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `transferencias_insert_admin_o_vendedor` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |
| `transferencias_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |

### `club_fotos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `club_fotos_delete_admin` | DELETE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | — |
| `club_fotos_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `club_fotos_select_own` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `club_fotos_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `jugadores_app`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `jugadores_app_insert_own` | INSERT | authenticated | PERMISSIVE | — | `(auth_user_id = auth.uid())` |
| `jugadores_app_select_authenticated` | SELECT | authenticated | PERMISSIVE | `true` | — |
| `jugadores_app_update_own` | UPDATE | authenticated | PERMISSIVE | `(auth_user_id = auth.uid())` | `(auth_user_id = auth.uid())` |

### `jugador_app_club_link`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `link_insert_own` | INSERT | authenticated | PERMISSIVE | — | `(jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` |
| `link_select_own` | SELECT | authenticated | PERMISSIVE | `(jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` | — |
| `link_update_admin` | UPDATE | authenticated | PERMISSIVE | `(club_id IN ( SELECT usuarios.club_id    FROM usuarios   WHERE ((usuarios.id = auth.uid()) AND ((usuarios.rol)::text = 'admin'::text))))` | — |

### `desafios`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `desafios_insert_own` | INSERT | authenticated | PERMISSIVE | — | `(jugador_app_id_de IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` |
| `desafios_select_own` | SELECT | authenticated | PERMISSIVE | `((jugador_app_id_de IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))) OR (jugador_app_id_para IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` | — |
| `desafios_update_own` | UPDATE | authenticated | PERMISSIVE | `((jugador_app_id_de IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))) OR (jugador_app_id_para IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` | — |

### `jugador_amigos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `amigos_delete_own` | DELETE | authenticated | PERMISSIVE | `((jugador_app_id_1 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))) OR (jugador_app_id_2 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` | — |
| `amigos_insert_own` | INSERT | authenticated | PERMISSIVE | — | `((jugador_app_id_1 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))) OR (jugador_app_id_2 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` |
| `amigos_select_own` | SELECT | authenticated | PERMISSIVE | `((jugador_app_id_1 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))) OR (jugador_app_id_2 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` | — |
| `amigos_update_own` | UPDATE | authenticated | PERMISSIVE | `((jugador_app_id_1 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))) OR (jugador_app_id_2 IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid()))))` | — |

### `club_posts`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `posts_delete_admin` | DELETE | authenticated | PERMISSIVE | `((club_id IN ( SELECT usuarios.club_id    FROM usuarios   WHERE ((usuarios.id = auth.uid()) AND ((usuarios.rol)::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[]))))) AND (usuario_id = auth.uid()))` | — |
| `posts_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id IN ( SELECT usuarios.club_id    FROM usuarios   WHERE ((usuarios.id = auth.uid()) AND ((usuarios.rol)::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[]))))) AND (usuario_id = auth.uid()))` |
| `posts_select_public` | SELECT | authenticated | PERMISSIVE | `(activo = true)` | — |
| `posts_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id IN ( SELECT usuarios.club_id    FROM usuarios   WHERE ((usuarios.id = auth.uid()) AND ((usuarios.rol)::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[]))))) AND (usuario_id = auth.uid()))` | — |

### `promociones`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `promo_delete_admin` | DELETE | authenticated | PERMISSIVE | `(club_id IN ( SELECT usuarios.club_id    FROM usuarios   WHERE ((usuarios.id = auth.uid()) AND ((usuarios.rol)::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[])))))` | — |
| `promo_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `(club_id IN ( SELECT usuarios.club_id    FROM usuarios   WHERE ((usuarios.id = auth.uid()) AND ((usuarios.rol)::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[])))))` |
| `promo_select_public` | SELECT | authenticated | PERMISSIVE | `(activo = true)` | — |
| `promo_update_admin` | UPDATE | authenticated | PERMISSIVE | `(club_id IN ( SELECT usuarios.club_id    FROM usuarios   WHERE ((usuarios.id = auth.uid()) AND ((usuarios.rol)::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[])))))` | — |

### `noticias_feed`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `noticias_feed_admin` | ALL | public | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[])))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::text[])))` |
| `noticias_feed_delete` | DELETE | public | PERMISSIVE | `true` | — |
| `noticias_feed_insert` | INSERT | public | PERMISSIVE | — | `true` |
| `noticias_feed_select` | SELECT | public | PERMISSIVE | `(activo = true)` | — |
| `noticias_feed_update` | UPDATE | public | PERMISSIVE | `true` | — |

### `club_mercadopago_config`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `club_mp_config_delete_admin` | DELETE | authenticated | PERMISSIVE | `(auth.uid() IN ( SELECT usuarios.id    FROM usuarios   WHERE ((usuarios.club_id = club_mercadopago_config.club_id) AND ((usuarios.rol)::text = 'admin'::text) AND (usuarios.activo = true))))` | — |
| `club_mp_config_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `(auth.uid() IN ( SELECT usuarios.id    FROM usuarios   WHERE ((usuarios.club_id = club_mercadopago_config.club_id) AND ((usuarios.rol)::text = 'admin'::text) AND (usuarios.activo = true))))` |
| `club_mp_config_select_admin` | SELECT | authenticated | PERMISSIVE | `(auth.uid() IN ( SELECT usuarios.id    FROM usuarios   WHERE ((usuarios.club_id = club_mercadopago_config.club_id) AND ((usuarios.rol)::text = 'admin'::text) AND (usuarios.activo = true))))` | — |
| `club_mp_config_update_admin` | UPDATE | authenticated | PERMISSIVE | `(auth.uid() IN ( SELECT usuarios.id    FROM usuarios   WHERE ((usuarios.club_id = club_mercadopago_config.club_id) AND ((usuarios.rol)::text = 'admin'::text) AND (usuarios.activo = true))))` | — |

### `bloqueos_horario`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `bloqueos_horario_all` | ALL | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `notificaciones`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `notificaciones_select_own` | SELECT | authenticated | PERMISSIVE | `(jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` | — |
| `notificaciones_update_own` | UPDATE | authenticated | PERMISSIVE | `(jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` | `(jugador_app_id IN ( SELECT jugadores_app.id    FROM jugadores_app   WHERE (jugadores_app.auth_user_id = auth.uid())))` |

### `buffet_mesas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `buffet_mesas_all` | ALL | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `buffet_mesa_consumos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `buffet_mesa_consumos_all` | ALL | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `jugador_movimientos_cuenta`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `jugador_movimientos_cuenta_all` | ALL | authenticated | PERMISSIVE | `(club_id = current_club_id())` | `(club_id = current_club_id())` |

### `categorias_gasto`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `categorias_gasto_insert_admin` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |
| `categorias_gasto_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `categorias_gasto_update_admin` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = 'admin'::text))` |

### `gastos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `gastos_insert_admin_o_vendedor` | INSERT | authenticated | PERMISSIVE | — | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |
| `gastos_select_propio_club` | SELECT | authenticated | PERMISSIVE | `(club_id = current_club_id())` | — |
| `gastos_update_admin_o_vendedor` | UPDATE | authenticated | PERMISSIVE | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` | `((club_id = current_club_id()) AND ((current_user_rol())::text = ANY ((ARRAY['admin'::character varying, 'vendedor'::character varying])::text[])))` |

