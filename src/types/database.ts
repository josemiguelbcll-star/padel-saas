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

  /**
   * Color de marca del club, en formato HSL triple sin wrap (convención
   * shadcn). Ej: '221 83% 53%'. Agregado en la 0016. Se inyecta al
   * iniciar sesión sobre el token CSS `--primary` del :root — el
   * `--ring` se propaga gratis vía `var(--primary)`. Default en la DB
   * es el valor actual de globals.css (los clubes existentes no notan
   * cambio hasta que un admin elija otro color). La paleta curada vive
   * en `src/lib/clubBrand.ts`.
   */
  color_primario_hsl: string;

  /**
   * Path interno del bucket `logos-clubes` (Supabase Storage). Formato:
   * "{club_id}/{uuid}.{ext}". NULL = sin logo (muestra solo el nombre
   * en el topbar). Agregado en la 0017. El cliente construye la URL
   * pública con el helper `getLogoClubUrl(path)` de
   * `src/lib/clubBrand.ts`.
   */
  logo_path: string | null;

  /**
   * Plan asignado al club (FK a `planes`). Agregado en la 0019.
   * NOT NULL en la DB con backfill inicial a 'pro' para todos los
   * clubes existentes (cero impacto funcional pre-0019). La lista de
   * módulos del plan se trae aparte vía `plan_modulos`.
   */
  plan_id: number;

  /**
   * Estado del club desde la perspectiva de la plataforma. Agregado
   * en la 0019. Backfill desde `activo`: TRUE→'activo', FALSE→'suspendido'.
   *   - 'trial': período de prueba (free con fecha de fin).
   *   - 'activo': pagando o gratis activo.
   *   - 'suspendido': acceso bloqueado temporalmente (puede reactivarse).
   *   - 'baja': baja definitiva (datos conservados pero sin acceso).
   */
  estado: EstadoClub;

  /**
   * Modalidad de caja del club (0022).
   *   - 'por_dia': una sola caja abierta por club.
   *   - 'por_vendedor': una caja abierta por (club, vendedor).
   * Default 'por_dia' (Signo Padel arranca acá). Cambio sólo por SQL hoy.
   */
  modalidad_caja: ModalidadCaja;
}

/**
 * Estado del club desde la perspectiva de la plataforma (0019).
 */
export type EstadoClub = 'trial' | 'activo' | 'suspendido' | 'baja';

/**
 * Modalidad de caja del club (0022).
 */
export type ModalidadCaja = 'por_dia' | 'por_vendedor';

/**
 * Tipo de un movimiento manual de caja (0022).
 *   - 'retiro': el operador retira efectivo (sale).
 *   - 'pago_proveedor': paga al proveedor en efectivo (sale).
 *   - 'ajuste_positivo': sobrante encontrado durante operación (entra).
 *   - 'ajuste_negativo': faltante encontrado durante operación (sale).
 */
export type TipoMovimientoCaja =
  | 'retiro'
  | 'pago_proveedor'
  | 'ajuste_positivo'
  | 'ajuste_negativo';

/**
 * Jornada de caja del club (0022). Apertura → cierre con arqueo.
 * Si `cerrada_en` es NULL, la caja está abierta y los campos de cierre
 * son NULL. Si está cerrada, todos los campos de cierre están seteados
 * (CHECK turnos_caja_cierre_atomico de la migración).
 *
 * En modalidad 'por_dia', `vendedor_id` es NULL. En 'por_vendedor', es
 * el UUID del vendedor dueño del cajón.
 */
export interface TurnoCaja {
  id: number;
  club_id: number;
  fecha_jornada: string;
  monto_apertura: number;
  usuario_apertura: string;
  abierta_en: string;
  modalidad: ModalidadCaja;
  vendedor_id: string | null;
  cerrada_en: string | null;
  usuario_cierre: string | null;
  efectivo_esperado: number | null;
  efectivo_contado: number | null;
  diferencia: number | null;
  observaciones_cierre: string | null;
}

// ============================================================================
// Migración 0027 — Módulo Financiero (unidades, categorías, gastos,
// otros_ingresos). Snapshots desnormalizados en gastos y otros_ingresos
// (patrón venta_items/reserva_consumos) — el EERR histórico no se rompe
// si el admin renombra una unidad o reasigna una categoría.
// ============================================================================

/**
 * Tipo de unidad de negocio (0027, 'financiero' agregado en 0036).
 * Determina de dónde se agregan los ingresos en el EERR:
 *   - canchas:    reservas
 *   - clases:     clase_cobros
 *   - buffet:     ventas linea='buffet'
 *   - shop:       ventas linea='shop'
 *   - auspicios:  otros_ingresos (manual)
 *   - membresias: otros_ingresos (manual)
 *   - estructura: SIN ingresos asociados (gastos transversales)
 *   - financiero: SIN ingresos asociados (gastos bancarios, comisiones,
 *                 intereses — capa "Resultados financieros" del EERR)
 *   - otro:       escape genérico
 *
 * Los 4 primeros (canchas/clases/buffet/shop) tienen UNIQUE PARCIAL
 * por club (uno por tipo); los otros pueden tener varias unidades.
 */
export type TipoUnidad =
  | 'canchas'
  | 'clases'
  | 'buffet'
  | 'shop'
  | 'auspicios'
  | 'membresias'
  | 'estructura'
  | 'financiero'
  | 'otro';

export interface UnidadNegocio {
  id: number;
  club_id: number;
  nombre: string;
  tipo: TipoUnidad;
  activa: boolean;
  orden: number;
  fecha_alta: string;
}

/**
 * Categoría de gasto (0027). Pertenece a UNA unidad. Si Buffet y Shop
 * tienen ambos "Mercadería", son dos filas distintas.
 */
export interface CategoriaGasto {
  id: number;
  club_id: number;
  unidad_id: number;
  nombre: string;
  activa: boolean;
  orden: number;
  fecha_alta: string;
}

/**
 * Gasto registrado en el módulo financiero (0027). Con snapshots de
 * categoría y unidad para que el EERR histórico sea fiel a la
 * clasificación al momento de cargar.
 *
 * Pago atómico: las 3 columnas (fecha_pago, medio_pago, turno_caja_id)
 * se comportan como un grupo:
 *   - Pendiente: las 3 NULL.
 *   - Pagado: fecha_pago + medio_pago obligatorios.
 *   - Si medio_pago='efectivo', turno_caja_id NOT NULL (regla de oro).
 */
export interface Gasto {
  id: number;
  club_id: number;
  categoria_id: number;
  categoria_nombre: string;
  unidad_id: number;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  monto: number;
  fecha_gasto: string;
  fecha_pago: string | null;
  medio_pago: MedioPago | null;
  turno_caja_id: number | null;
  proveedor: string | null;
  observaciones: string | null;
  activo: boolean;
  usuario_id: string;
  fecha_alta: string;
}

/**
 * Otro ingreso (0027). Auspicios, membresías, etc. Los ingresos
 * operativos (reservas, ventas, clase_cobros) NO se duplican acá.
 * Mismo patrón de pago atómico que Gasto.
 */
export interface OtroIngreso {
  id: number;
  club_id: number;
  unidad_id: number;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  concepto: string;
  monto: number;
  fecha: string;
  fecha_cobro: string | null;
  medio_pago: MedioPago | null;
  turno_caja_id: number | null;
  observaciones: string | null;
  activo: boolean;
  usuario_id: string;
  fecha_alta: string;
}

/**
 * Movimiento manual sobre una caja abierta (0022). Inmutable — corregir
 * = registrar un movimiento compensatorio. El signo (suma o resta al
 * esperado) lo determina `tipo`.
 */
export interface CajaMovimientoManual {
  id: number;
  club_id: number;
  turno_caja_id: number;
  tipo: TipoMovimientoCaja;
  monto: number;
  concepto: string;
  observaciones: string | null;
  usuario_id: string;
  fecha_hora: string;
}

/**
 * Módulo del sistema (0019). Catálogo configurable de funcionalidades
 * que un plan puede incluir. `codigo` es el identificador estable
 * usado en código (frontend y RLS).
 */
export interface Modulo {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  orden: number;
  activo: boolean;
}

/**
 * Plan del SaaS (0019). Combinación de módulos a un precio. Cada club
 * tiene asignado un plan (via `Club.plan_id`).
 */
export interface Plan {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual: number;
  orden: number;
  activo: boolean;
}

/**
 * Superadmin de la plataforma (0019). Vive en la tabla
 * `plataforma_admins`, aparte de `usuarios` — es del SaaS, no de un
 * club. El SessionProvider lo expone vía `useSession().plataformaAdmin`.
 *
 * Un usuario puede tener fila en `plataforma_admins` Y en `usuarios`
 * al mismo tiempo (caso del owner del SaaS que también era admin de
 * un club). El SessionProvider chequea `plataforma_admins` PRIMERO:
 * si es superadmin activo, entra como superadmin sin importar su
 * fila en `usuarios`.
 */
export interface PlataformaAdmin {
  id: string;
  nombre: string;
  email: string;
}

export interface Usuario {
  id: string;
  club_id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
  fecha_alta: string;
  /**
   * Snapshot del email del usuario en `auth.users`. Agregado en la
   * 0018 (denormalización — el front no puede leer `auth.users` sin
   * service_role). La Edge Function `crear-vendedor` lo llena al
   * crear. Backfill aplicado a usuarios pre-0018. Puede quedar NULL
   * para casos edge (auth.users sin email).
   */
  email: string | null;
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
  /**
   * Vigencia temporal del PRECIO (0029). La franja como tal es atemporal
   * — son los cambios de monto los que se versionan.
   * - `vigente_desde`: primera fecha en que este monto aplica.
   * - `vigente_hasta`: última fecha en que este monto aplica. NULL = abierto.
   *
   * `resolverTarifa` filtra por fecha: la tarifa aplica si la fecha del
   * slot está en [vigente_desde, vigente_hasta].
   */
  vigente_desde: string;
  vigente_hasta: string | null;
  /**
   * Agrupa todas las versiones de precio de la MISMA franja a lo largo
   * del tiempo (0029). La primera versión apunta a sí misma
   * (lineage_id = id). Cambios de precio crean filas nuevas con el
   * mismo lineage_id.
   */
  lineage_id: number;
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
  /**
   * Link al turno fijo del que nació esta reserva (materialización, 0030).
   * NULL = reserva suelta (creada manualmente desde la grilla).
   * ON DELETE SET NULL: si se borra físicamente el turno fijo (caso raro
   * — normalmente se desactiva), la reserva histórica se preserva.
   */
  turno_fijo_id: number | null;
}

/**
 * Rol de una persona en el turno (columna `reserva_jugadores.tipo` desde
 * la migración 0012):
 *   - 'jugador': juega + pesa para dividir el alquiler (paso 3).
 *   - 'invitado': sólo consume buffet, estrictamente anónimo.
 */
export type TipoPersonaTurno = 'jugador' | 'invitado';

export interface ReservaJugador {
  id: number;
  club_id: number;
  reserva_id: number;
  /**
   * ID del jugador registrado en la tabla `jugadores`. NULL si todavía
   * no se registró (ver nombre_libre) o si es un jugador anónimo
   * ("Jugador N", numerado client-side).
   */
  jugador_id: number | null;
  /**
   * Nombre del acompañante "suelto" que aún no es un jugador registrado.
   * NULL cuando jugador_id está seteado o cuando es anónimo (jugador
   * "Jugador N" o invitado "Invitado N").
   */
  nombre_libre: string | null;
  es_titular: boolean;
  /**
   * Migración 0012. Para `'invitado'` el CHECK exige
   * jugador_id=NULL, nombre_libre=NULL, es_titular=false.
   */
  tipo: TipoPersonaTurno;
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
   * FK histórica a la ficha global del jugador (`jugadores.id`). NULL
   * cuando el pago no se atribuye a una ficha (cobro grupal legacy o
   * persona sin ficha en el turno). Distinto de `reserva_jugador_id`:
   * acá apuntamos a la ficha, allá a la persona del turno.
   */
  jugador_id: number | null;
  /**
   * FK a la persona del turno que pagó (`reserva_jugadores.id`).
   * Agregado en la migración 0014 (paso 4 — pagos por persona).
   * NULL en pagos huérfanos legacy (reservas sin titular en
   * reserva_jugadores) o si la persona se quitó después del pago
   * (ON DELETE SET NULL preserva el pago histórico). Los reportes
   * EERR que requieran atribución a persona deben filtrar IS NOT NULL.
   */
  reserva_jugador_id: number | null;
  /**
   * DECIMAL(12,2). Porción del monto del pago que corresponde al
   * ALQUILER de la cancha. Snapshot. Agregado en la 0014. El CHECK
   * `reserva_pagos_desglose_check` garantiza
   * `monto_alquiler + monto_consumo = monto`.
   */
  monto_alquiler: number;
  /**
   * DECIMAL(12,2). Porción del monto del pago que corresponde a
   * CONSUMOS de buffet cargados al turno. Snapshot. Agregado en la 0014.
   * Para reportes EERR de la unidad de negocio "Buffet" — estos pagos
   * se suman a los de venta_items (mostrador) para el total de la unidad.
   */
  monto_consumo: number;
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

/**
 * Línea de negocio del producto (0024).
 *   - 'buffet': comida y bebida que se consume jugando.
 *   - 'shop':   artículos de pádel, vestimenta, etc.
 * Determina dónde se muestra el producto y qué categorías son válidas.
 */
export type Linea = 'buffet' | 'shop';

/** Categorías permitidas cuando linea='buffet' (CHECK compuesto en 0024). */
export type CategoriaBuffet = 'bebidas' | 'snacks' | 'comidas' | 'otros';

/** Categorías permitidas cuando linea='shop' (CHECK compuesto en 0024). */
export type CategoriaShop =
  | 'articulos_padel'
  | 'vestimenta'
  | 'palas'
  | 'accesorios';

/**
 * Categoría del producto. Union de las categorías de cada línea. La
 * validación de "qué categoría va con qué línea" la hace el CHECK
 * compuesto `productos_categoria_segun_linea` server-side, y el
 * superRefine en el schema zod del frontend.
 */
export type CategoriaProducto = CategoriaBuffet | CategoriaShop;

/**
 * Origen de un movimiento de stock.
 *
 *   - 'compra_manual':       entrada via fn_registrar_movimiento_stock (admin).
 *   - 'venta':               salida por venta de mostrador (fn_cerrar_venta).
 *   - 'consumo_turno':       salida por consumo cargado a la cuenta del
 *                            turno (fn_cargar_consumo_turno) — agregado en
 *                            la 0013.
 *   - 'reposicion_consumo':  entrada por quitado de un consumo del turno
 *                            (fn_quitar_consumo_turno) — agregado en la
 *                            0013. La fuente es explícita (vs un 'ajuste'
 *                            genérico) para que los reportes puedan
 *                            cuantificar el flujo de "stock movido por
 *                            quitados de turno" aparte.
 *   - 'ajuste':              correcciones manuales de inventario (admin,
 *                            RPC futura).
 *   - 'compra_bot_whatsapp': futura integración con bot de WhatsApp para
 *                            cargar facturas de compra (ver CLAUDE.md).
 */
export type FuenteMovimientoStock =
  | 'compra_manual'
  | 'venta'
  | 'ajuste'
  | 'compra_bot_whatsapp'
  | 'consumo_turno'
  | 'reposicion_consumo';

export interface Producto {
  id: number;
  club_id: number;
  nombre: string;
  /** Línea de negocio (0024). Determina dónde se muestra el producto. */
  linea: Linea;
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
  /** NOT NULL sólo cuando fuente='venta'; NULL en compras, ajustes y consumos de turno. */
  venta_id: number | null;
  /**
   * FK al consumo del turno que originó este movimiento. NOT NULL al
   * INSERT para fuente='consumo_turno' (lo pone fn_cargar_consumo_turno),
   * pero pasa a NULL si el consumo se borra (ON DELETE SET NULL — Modelo
   * B de la 0013, preserva el movimiento de salida como evidencia
   * histórica). Para fuente='reposicion_consumo' es NULL siempre (la
   * reposición no apunta al consumo, su contexto va en observaciones).
   * Agregado en la migración 0013.
   */
  reserva_consumo_id: number | null;
  observaciones: string | null;
  usuario_id: string;
  fecha_hora: string;
}

/**
 * Cómo se reparte un consumo entre las personas del turno (migración
 * 0015):
 *   - 'partido': sólo entre JUGADORES (caso típico: un tarro de
 *     pelotas — los invitados no lo pagan).
 *   - 'general': entre TODAS las personas (jugadores + invitados).
 *     Default — la mayoría de los consumos (bebidas, snacks).
 *
 * La distinción es SOLO para repartir la cuenta entre personas. NO
 * cambia la atribución contable: todo el consumo sigue siendo línea
 * "Buffet" en el EERR (reserva_pagos.monto_consumo es el agregado).
 */
export type TipoRepartoConsumo = 'partido' | 'general';

/**
 * Consumo de buffet cargado a la cuenta del turno (paso 2 del módulo
 * cuenta del turno — migración 0013). Cada fila es un producto vendido
 * como parte del turno (NO de una venta de mostrador). Snapshots de
 * nombre/precio/costo para que el total del turno y los reportes de
 * margen sean fieles aunque el producto cambie después.
 */
export interface ReservaConsumo {
  id: number;
  club_id: number;
  reserva_id: number;
  producto_id: number;
  /** Snapshot del nombre al momento de la carga. */
  producto_nombre: string;
  /** DECIMAL(12,2). Snapshot del precio al momento de la carga. */
  precio_unitario: number;
  /**
   * DECIMAL(12,2) NULLABLE. Snapshot del costo al momento de la carga.
   * NULL = el producto no tenía costo cargado en ese momento (ver
   * decisión de la 0010); margen "no calculable" para esta línea.
   */
  costo_unitario: number | null;
  /** INT > 0. */
  cantidad: number;
  /** DECIMAL(12,2). cantidad × precio_unitario al cargar. */
  subtotal: number;
  /**
   * Cómo se reparte este consumo entre las personas del turno.
   * Definido al cargar; no editable después (si se equivocó: quitar
   * + cargar de nuevo). Agregado en la migración 0015 con DEFAULT
   * 'general' (los consumos pre-0015 se repartían entre todos, así
   * que el backfill al default es semánticamente correcto).
   */
  tipo_reparto: TipoRepartoConsumo;
  /**
   * Snapshot de productos.linea al momento de la carga (0024). Sirve
   * para el EERR (saber si fue buffet o shop) aunque el producto se
   * reclasifique después. fn_cargar_consumo_turno lo escribe.
   */
  linea: Linea;
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
  /**
   * Snapshot de productos.linea al momento de la venta (0024). Sirve
   * para el EERR aunque el producto se reclasifique después.
   * fn_cerrar_venta lo escribe.
   */
  linea: Linea;
}

// ============================================================================
// Migración 0034 — Tarifas de clases (alquiler de cancha para clases)
// ============================================================================

/**
 * Tarifa de alquiler de cancha para clases (0034). Misma forma que
 * `Tarifa`: lineage_id agrupa versiones de precio de la misma franja a
 * lo largo del tiempo, vigente_desde/hasta define el rango.
 *
 * Se mantiene como interface separada para tipado documentado; los hooks
 * y dialogs reusan el tipo `Tarifa` en sus firmas porque la forma es
 * idéntica. Si en el futuro las tablas divergen (ej. clases agrega una
 * columna), separamos los tipos.
 */
export interface TarifaClase extends Tarifa {}


// ============================================================================
// Migración 0030 — Turnos fijos (reservas recurrentes con clientes habituales)
// ============================================================================

/**
 * Turno fijo: acuerdo recurrente cancha + día de la semana + hora con un
 * cliente habitual. La materialización (fn_materializar_turnos_fijos)
 * genera reservas concretas semana a semana a partir de esta definición.
 *
 * Las reservas materializadas tienen `reservas.turno_fijo_id = id` y se
 * cobran/cancelan individualmente como cualquier reserva — el turno fijo
 * sigue activo aunque se cancele una semana puntual.
 */
export interface TurnoFijo {
  id: number;
  club_id: number;
  cancha_id: number;

  /**
   * Titular: jugador registrado (jugador_id) O nombre libre. CHECK
   * server-side obliga uno de los dos.
   */
  jugador_id: number | null;
  nombre_libre: string | null;

  /** ISO: 1=lunes, 7=domingo. */
  dia_semana: number;
  /** 'HH:MM:SS'. */
  hora_inicio: string;
  /** 60 | 90 | 120 | 150 | 180 | 240. */
  duracion_min: number;

  /** 'YYYY-MM-DD'. Primera fecha desde la que se puede materializar. */
  fecha_desde: string;
  /** 'YYYY-MM-DD' o NULL = indefinido. */
  fecha_hasta: string | null;

  /**
   * Soft-disable: cancelar un turno fijo lo pone en FALSE (las reservas
   * ya materializadas se mantienen, las futuras NO se generan más).
   */
  activo: boolean;
  observaciones: string | null;
  usuario_alta_id: string;
  fecha_alta: string;
}

/**
 * Retorno de fn_materializar_turnos_fijos. 5 contadores para que el
 * admin entienda exactamente qué pasó al generar:
 *  - reservas_creadas: las que efectivamente se materializaron.
 *  - slots_ocupados_por_reserva_suelta: el slot estaba tomado por una
 *    reserva NO turno-fijo (EXCLUDE no_overlap_reservas). NO se pisa.
 *  - slots_ocupados_por_clase: choque con clase activa.
 *  - slots_sin_tarifa: NO hay tarifa vigente que cubra el slot+fecha.
 *    NO se materializa para no ensuciar la proyección financiera.
 *  - slots_ya_materializados: idempotencia (la fecha ya tenía reserva
 *    de este turno fijo).
 */
export interface ResultadoMaterializacion {
  reservas_creadas: number;
  slots_ocupados_por_reserva_suelta: number;
  slots_ocupados_por_clase: number;
  slots_sin_tarifa: number;
  slots_ya_materializados: number;
}

/** Retorno de fn_cancelar_turno_fijo. */
export interface ResultadoCancelacionTurnoFijo {
  reservas_canceladas: number;
}
