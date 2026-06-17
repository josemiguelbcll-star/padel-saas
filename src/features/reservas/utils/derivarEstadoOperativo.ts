import type { EstadoOperativo, EstadoReserva } from '@/types/database';

/**
 * Insumos para derivar el estado operativo de un turno. Se toman explícitos
 * (no una `Reserva` entera) para servir a los dos orígenes de los flags:
 *  - la grilla del día (que arma `tieneConsumo`/`tienePago` desde Sets de ids
 *    cargados con dos queries companion, sin N+1), y
 *  - la vista `v_reservas_operativas` (que ya trae `tiene_consumo`/`tiene_pago`).
 */
export interface DerivarEstadoOperativoInput {
  estado: EstadoReserva;
  /** reservas.cerrado_en — NULL = no cerrado. */
  cerrado_en: string | null;
  /** 'YYYY-MM-DD'. */
  fecha: string;
  /** 'HH:MM:SS' o 'HH:MM'. */
  hora_inicio: string;
  tieneConsumo: boolean;
  tienePago: boolean;
}

/**
 * Estado OPERATIVO derivado del turno (capa encima del enum `estado`).
 * Precedencia (de terminal a inicial) — espejo de la regla documentada y de
 * la vista `v_reservas_operativas` (0054):
 *
 *   1. CANCELADO  → estado = 'cancelada' (terminal del enum).
 *   2. CERRADO    → cerrado_en IS NOT NULL (cierre manual, terminal).
 *   3. RESERVADO  → estado = 'pendiente' (se queda reservado hasta que se pague la seña o el club lo confirme).
 *   4. ABIERTO    → llegó la hora de inicio  O  hay consumo/pago (y no cerrado ni pendiente).
 *   5. RESERVADO  → resto (no llegó la hora y sin consumo ni pago).
 *
 * `now` se pasa explícito (testable y permite que la grilla lo memoice). La
 * transición RESERVADO→ABIERTO por hora es continua: recalcular con un `now`
 * nuevo la refleja sin re-consultar la DB.
 *
 * Función PURA, sin React ni side effects.
 */
export function derivarEstadoOperativo(
  input: DerivarEstadoOperativoInput,
  now: Date,
): EstadoOperativo {
  if (input.estado === 'cancelada') return 'cancelado';
  if (input.cerrado_en !== null) return 'cerrado';

  // 'YYYY-MM-DDTHH:MM:SS' sin offset → se parsea en hora LOCAL (mismo criterio
  // que fechaUtils / LineaAhora; evita drift por UTC).
  const inicio = new Date(`${input.fecha}T${input.hora_inicio}`);
  const llegoLaHora = now.getTime() >= inicio.getTime();

  // Si no pagó la seña y no está confirmada por el club (sigue 'pendiente'),
  // no pasa a 'abierto' (alquilada) y se queda en 'reservado'.
  if (input.estado === 'pendiente') return 'reservado';

  if (llegoLaHora || input.tieneConsumo || input.tienePago) return 'abierto';
  return 'reservado';
}

/**
 * Info visual por reserva que la grilla baja a cada bloque: estado operativo
 * + flags de actividad (para los micro-íconos $ / consumo). Se arma en
 * ReservasPage desde el mapa de estados + los Sets de useActividadDelDia.
 */
export interface InfoReservaVisual {
  estado: EstadoOperativo;
  tieneConsumo: boolean;
  tienePago: boolean;
}

/** Etiqueta legible de cada estado operativo. */
export const ESTADO_OPERATIVO_LABEL: Record<EstadoOperativo, string> = {
  reservado: 'Reservado',
  abierto: 'Abierto',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};

/**
 * Color del estado operativo como `hsl(var(--estado-op-X))`. Se aplica por
 * inline-style (mismo patrón que los bloques de la grilla) para no depender
 * de clases dinámicas de Tailwind. Tokens en globals.css.
 */
export function estadoOperativoColorVar(estado: EstadoOperativo): string {
  return `hsl(var(--estado-op-${estado}))`;
}

/** Color de texto sobre el fondo del estado operativo. */
export function estadoOperativoColorFgVar(estado: EstadoOperativo): string {
  return `hsl(var(--estado-op-${estado}-foreground))`;
}
