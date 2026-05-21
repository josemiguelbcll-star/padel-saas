/**
 * Tipos del dominio.
 *
 * Convenciones:
 * - Columnas NOT NULL → tipo simple (string, number, boolean, ...).
 * - Columnas que existen pero pueden ser NULL → `Tipo | null`. NO usamos
 *   el modificador opcional `?` para esos casos: el campo siempre está
 *   presente en la fila devuelta por Supabase, lo que puede pasar es
 *   que valga null. La distinción importa para que el frontend maneje
 *   los dos estados explícitamente.
 * - DECIMAL/NUMERIC se modelan como `number`, alineado con la salida del
 *   tool oficial `supabase gen types typescript`. Para los DECIMAL(12,2)
 *   de moneda que maneja el sistema (pesos), la precisión de Number es
 *   más que suficiente.
 * - DATE se modela como `string` con formato 'YYYY-MM-DD'.
 * - TIME se modela como `string` con formato 'HH:MM:SS' (o 'HH:MM' al
 *   enviar — Postgres lo acepta).
 * - TIMESTAMPTZ se modela como `string` (ISO 8601).
 *
 * Sincronizado con:
 *   - 0001_initial_schema.sql                   (clubes, usuarios)
 *   - 0003_canchas_y_tarifas.sql                (canchas, tarifas, horarios en clubes)
 *   - 0004_reservas_jugadores_franjas.sql       (jugadores, reservas,
 *                                                reserva_jugadores, reserva_pagos,
 *                                                franjas_duracion [deprecada en 0005,
 *                                                tipo TS removido del codebase])
 *   - 0005_clases_profesores.sql                (profesores, clases;
 *                                                deprecación de franjas_duracion)
 */

export type Rol = 'admin' | 'vendedor';
export type PlanClub = 'gratis' | 'crece' | 'club';

export interface Club {
  id: number;
  nombre: string;
  slug: string;
  direccion: string | null;
  ciudad: string | null;
  provincia: string | null;
  telefono: string | null;
  email: string | null;
  plan: PlanClub;
  activo: boolean;
  fecha_alta: string;
  config: Record<string, unknown>;

  // Horarios de operación (agregados en 0003).
  // hora_apertura y hora_cierre arrancan en NULL para el club recién creado;
  // se setean en el onboarding o desde Configuración → Horarios.
  hora_apertura: string | null;
  hora_cierre: string | null;
  // NOT NULL en la DB con DEFAULT 90 y CHECK IN (60, 90, 120, 150, 180, 240).
  duracion_turno_default: number;
}

export interface Usuario {
  id: string;
  club_id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
  fecha_alta: string;
}

export interface Cancha {
  id: number;
  club_id: number;
  nombre: string;
  /** Texto libre: 'cristal', 'cemento', 'muro', etc. NULL si no se especificó. */
  tipo: string | null;
  cubierta: boolean;
  activa: boolean;
  /** Orden de aparición en la grilla. Default 0. */
  orden: number;
}

export interface Tarifa {
  id: number;
  club_id: number;
  nombre: string;
  /** DECIMAL(12,2) en la DB. Modelado como number para ergonomía. */
  monto: number;
  /** TIME 'HH:MM:SS' o NULL. NULL significa "la tarifa aplica a toda hora". */
  desde_hora: string | null;
  /** TIME 'HH:MM:SS' o NULL. NULL significa "la tarifa aplica a toda hora". */
  hasta_hora: string | null;
  /**
   * Array de días donde aplica la tarifa.
   * 1 = lunes, 7 = domingo.
   * NULL significa "la tarifa aplica a todos los días".
   */
  dias_semana: number[] | null;
  /** Mayor número gana. Cuando dos tarifas se superponen, gana la de mayor prioridad. */
  prioridad: number;
  activa: boolean;
}

// ============================================================================
// Migración 0004 — Reservas, jugadores, franjas, pagos
// ============================================================================

/** Estados posibles de una reserva (CHECK en reservas.estado). */
export type EstadoReserva =
  | 'pendiente'
  | 'senada'
  | 'pagada'
  | 'jugada'
  | 'cancelada';

/** Medios de pago aceptados (CHECK en reserva_pagos.medio_pago). */
export type MedioPago =
  | 'efectivo'
  | 'transferencia'
  | 'mp'
  | 'tarjeta'
  | 'otro';

/** Tipos de movimiento en reserva_pagos (CHECK en reserva_pagos.tipo). */
export type TipoPago = 'sena' | 'pago' | 'reembolso';

/** Género del jugador. NULL = no cargado. Enum cerrado en la DB (CHECK). */
export type GeneroJugador = 'masculino' | 'femenino' | 'otro';

/**
 * Categoría del jugador en la escala oficial del pádel argentino (1ra a
 * 8va). NULL = no cargado. Enum cerrado en la DB (CHECK).
 */
export type CategoriaJugador =
  | 'octava'
  | 'septima'
  | 'sexta'
  | 'quinta'
  | 'cuarta'
  | 'tercera'
  | 'segunda'
  | 'primera';

/** Posición preferida en la cancha. NULL = no cargado. Enum cerrado (CHECK). */
export type PosicionJugador = 'drive' | 'reves' | 'ambos';

export interface Jugador {
  id: number;
  club_id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  /**
   * @deprecated Texto libre legacy de la migración 0004 (ej. '3ra', 'B',
   * 'principiante'). Reemplazado conceptualmente por `categoria` (enum
   * cerrado) en la migración 0011. La columna sigue en DB para no
   * perder datos pre-0011; los UIs nuevos NO la leen ni escriben.
   * Si en algún momento se quiere consolidar, mapeo manual desde
   * Supabase Studio (no automatizable: los valores viejos pueden ser
   * cualquier cosa).
   */
  nivel: string | null;
  notas: string | null;
  /** Migración 0011. NULL = no cargado. */
  genero: GeneroJugador | null;
  /** Migración 0011. NULL = no cargado. */
  categoria: CategoriaJugador | null;
  /** Migración 0011. NULL = no cargado. */
  posicion: PosicionJugador | null;
  fecha_alta: string;
  activo: boolean;
}

export interface Reserva {
  id: number;
  club_id: number;
  cancha_id: number;
  /**
   * Titular de la reserva. NULL si la reserva sólo tiene "nombres libres"
   * (acompañantes sin registro de jugador todavía).
   */
  jugador_id: number | null;
  /** Fecha en formato 'YYYY-MM-DD'. */
  fecha: string;
  /** Hora de inicio 'HH:MM:SS'. */
  hora_inicio: string;
  /**
   * Hora de fin 'HH:MM:SS'. La calcula la RPC fn_crear_reserva como
   * hora_inicio + duracion_min para garantizar coherencia.
   */
  hora_fin: string;
  /** Una de las 6 duraciones válidas: 60, 90, 120, 150, 180, 240. */
  duracion_min: number;
  /** Tarifa aplicada al crear la reserva. NULL si el admin sobreescribió el monto sin elegir tarifa. */
  tarifa_id: number | null;
  monto_total: number;
  /** Porción del monto_pagado correspondiente a la seña inicial. La RPC la setea = monto_pagado cuando estado='senada'. */
  monto_sena: number;
  /** Suma acumulada de todos los reserva_pagos asociados. La mantiene la RPC. */
  monto_pagado: number;
  estado: EstadoReserva;
  observaciones: string | null;
  /** UUID del usuario que dio de alta la reserva. NULL si el usuario fue eliminado. */
  usuario_alta_id: string | null;
  fecha_alta: string;
}

export interface ReservaJugador {
  id: number;
  club_id: number;
  reserva_id: number;
  /** ID del jugador registrado en la tabla `jugadores`. NULL si todavía no se registró (ver nombre_libre). */
  jugador_id: number | null;
  /** Nombre del acompañante "suelto" que aún no es un jugador registrado. NULL cuando jugador_id está seteado. */
  nombre_libre: string | null;
  es_titular: boolean;
}

export interface ReservaPago {
  id: number;
  club_id: number;
  reserva_id: number;
  /** DECIMAL(12,2). Siempre > 0. Para revertir un cobro se inserta otra fila con tipo='reembolso'. */
  monto: number;
  medio_pago: MedioPago;
  tipo: TipoPago;
  /**
   * Para división de cuenta: jugador que pagó esta porción.
   * NULL = pago grupal (default en sprint 3a; el flujo simple no asigna pagos a jugadores).
   */
  jugador_id: number | null;
  observaciones: string | null;
  usuario_id: string;
  fecha_hora: string;
}

// La interfaz FranjaDuracion fue removida en la limpieza del Sprint 3a
// (deprecada por la migración 0005). La tabla franjas_duracion sigue
// existiendo en la DB con un COMMENT que la marca deprecada, pero el
// codebase no la usa. Si en algún momento hace falta consultarla
// (ej. para una migración de datos), declarar el tipo localmente.

// ============================================================================
// Migración 0005 — Profesores y clases (cambio de modelo en Reservas)
// ============================================================================

export interface Profesor {
  id: number;
  club_id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  fecha_alta: string;
}

export interface Clase {
  id: number;
  club_id: number;
  profesor_id: number;
  cancha_id: number;
  /**
   * Nombre opcional de la clase (ej. "Principiantes", "Avanzado").
   * Si está null, la UI muestra "Clase · {Profesor}" usando el nombre
   * del profesor. Útil cuando un mismo profesor tiene varias clases
   * distintas que conviene diferenciar.
   */
  nombre: string | null;
  /**
   * Días donde la clase ocurre. 1 = lunes, 7 = domingo.
   * NOT NULL en la DB (a diferencia de tarifas/franjas, donde NULL =
   * todos los días). Una clase sin días no tiene sentido operativo:
   * el array siempre tiene entre 1 y 7 elementos en [1..7].
   */
  dias_semana: number[];
  /**
   * Hora de inicio 'HH:MM:SS'. Restringida a múltiplos de 30 minutos
   * por CHECK (alineación con la grilla de 30 min).
   */
  hora_inicio: string;
  /** Una de las 6 duraciones válidas: 60, 90, 120, 150, 180, 240. Default 60. */
  duracion_min: number;
  /**
   * Precio propio de la clase, DECIMAL(12,2) en la DB. INDEPENDIENTE
   * del sistema de tarifas: las clases no aplican tarifas (esas son
   * sólo para partidos).
   */
  precio: number;
  activa: boolean;
  fecha_alta: string;
}

// ============================================================================
// Migración 0007 — Cobro de clases (por ocurrencia)
// ============================================================================

/**
 * Cobro de una ocurrencia puntual de clase (clase recurrente X dictada
 * el día Y). Una fila por cada vez que el club cobra el alquiler al
 * profesor. La tabla tiene UNIQUE (clase_id, fecha) para impedir doble
 * cobro de la misma ocurrencia.
 */
export interface ClaseCobro {
  id: number;
  club_id: number;
  clase_id: number;
  /** DATE 'YYYY-MM-DD'. Coincide con un día de clases.dias_semana. */
  fecha: string;
  /**
   * DECIMAL(12,2). Default sugerido en la UI = clases.precio, pero
   * editable por si el club acuerda un valor distinto.
   */
  monto: number;
  medio_pago: MedioPago;
  observaciones: string | null;
  usuario_id: string;
  /** TIMESTAMPTZ del momento del cobro. */
  fecha_hora: string;
}

// ============================================================================
// Migración 0009 — Buffet Capa 1 (productos, stock, ventas)
// ============================================================================

/** Categoría del producto. CHECK enum en la DB; ampliar requiere migración. */
export type CategoriaProducto = 'bebida' | 'snack' | 'otro';

/**
 * Origen de un movimiento de stock. El bot de carga de facturas vía
 * WhatsApp (visión a futuro en CLAUDE.md) usará `compra_bot_whatsapp`
 * cuando se construya; la Capa 1 sólo emite `compra_manual` y `venta`.
 * `ajuste` queda reservado para correcciones de inventario (admin, RPC
 * futura).
 */
export type FuenteMovimientoStock =
  | 'compra_manual'
  | 'venta'
  | 'ajuste'
  | 'compra_bot_whatsapp';

export interface Producto {
  id: number;
  club_id: number;
  nombre: string;
  categoria: CategoriaProducto;
  /** DECIMAL(12,2). >= 0 por CHECK. */
  precio: number;
  /**
   * DECIMAL(12,2) NULLABLE. Último costo conocido (lo que le cuesta al
   * club comprarlo). NULL = no cargado — la UI debe mostrar "—" y los
   * reportes deben excluirlo del cálculo de margen (NO asumir 0, eso
   * inflaría el EERR). Agregado en la migración 0010.
   */
  costo: number | null;
  /**
   * Umbral de alerta visual "stock bajo" en la pantalla de productos.
   * 0 = sin alerta. Cuando stock_actual > 0 AND stock_actual < stock_minimo,
   * el row se marca en ámbar.
   */
  stock_minimo: number;
  activo: boolean;
  fecha_alta: string;
}

/**
 * Producto + stock actual calculado por la vista `vw_productos_con_stock`
 * (SUM de movimientos_stock). Usado en listados visuales: Configuración →
 * Productos y catálogo del buffet.
 */
export interface ProductoConStock extends Producto {
  /** INT, suma de movimientos. Puede ser 0 (sin movimientos) o negativo si
   *  hay algún error de inventario que ningún CHECK pudo prevenir (no debería). */
  stock_actual: number;
}

export interface MovimientoStock {
  id: number;
  club_id: number;
  producto_id: number;
  /**
   * INT, distinto de 0. Positivo = entrada, negativo = salida.
   * El CHECK estricto `mov_stock_coherencia_fuente` en la 0009 garantiza
   * coherencia con `fuente` y `venta_id` (ej. venta obliga negativo y
   * venta_id no nulo).
   */
  cantidad: number;
  fuente: FuenteMovimientoStock;
  /** NOT NULL sólo cuando fuente='venta'; NULL en compras y ajustes. */
  venta_id: number | null;
  observaciones: string | null;
  usuario_id: string;
  fecha_hora: string;
}

export interface Venta {
  id: number;
  club_id: number;
  /** DECIMAL(12,2). Snapshot del total al cierre = SUM(venta_items.subtotal). */
  monto_total: number;
  medio_pago: MedioPago;
  observaciones: string | null;
  usuario_id: string;
  fecha_hora: string;
  /**
   * Reservados para la Capa fiscal/contable futura. La Capa 1 los deja
   * NULL siempre; cuando se conecte facturación, se llenan vía UPDATE
   * sin migración destructiva.
   */
  comprobante_tipo: string | null;
  comprobante_numero: string | null;
  /** DATE 'YYYY-MM-DD'. */
  comprobante_fecha: string | null;
}

export interface VentaItem {
  id: number;
  club_id: number;
  venta_id: number;
  producto_id: number;
  /** Snapshot del nombre al momento de la venta. Sobrevive renombrados o borrados. */
  producto_nombre: string;
  /** INT > 0. */
  cantidad: number;
  /** DECIMAL(12,2). Snapshot del precio cobrado, no del precio actual. */
  precio_unitario: number;
  /**
   * DECIMAL(12,2) NULLABLE. Snapshot del costo al momento de la venta.
   * NULL = el producto no tenía costo cargado en ese momento; el margen
   * de esta línea es "no calculable" (los reportes deben excluirla del
   * cálculo de margen, NO asumir 0). Agregado en la migración 0010.
   */
  costo_unitario: number | null;
  /** DECIMAL(12,2). cantidad × precio_unitario al cierre. */
  subtotal: number;
}
