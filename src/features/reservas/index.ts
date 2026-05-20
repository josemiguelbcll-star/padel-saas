// Página principal
export { ReservasPage } from './ReservasPage';

// Hooks
export {
  useReservasDelDia,
  reservasDelDiaQueryKey,
  RESERVAS_QUERY_KEY_BASE,
  type ReservaConTitular,
} from './hooks/useReservasDelDia';
export {
  useJugadoresSearch,
  useCreateJugador,
  JUGADORES_QUERY_KEY_BASE,
  type JugadorInput,
} from './hooks/useJugadores';
export {
  useCrearReserva,
  type CrearReservaInput,
} from './hooks/useCrearReserva';
export {
  useActualizarReserva,
  type ActualizarReservaInput,
  type ActualizarReservaChanges,
} from './hooks/useActualizarReserva';
export {
  useReservaJugadores,
  RESERVA_JUGADORES_QUERY_KEY_BASE,
  type ReservaJugadorConNombre,
} from './hooks/useReservaJugadores';
export {
  useReservaPagos,
  RESERVA_PAGOS_QUERY_KEY_BASE,
} from './hooks/useReservaPagos';
export {
  useCobrarReserva,
  type CobrarReservaInput,
} from './hooks/useCobrarReserva';

// Utils
export {
  formatearFechaISO,
  diaSemanaDe,
  fechaHoy,
  fechaSiguiente,
  fechaAnterior,
  formatearFechaAmigable,
} from './utils/fechaUtils';
export {
  normalizarHora,
  formatearHora,
  sumarMinutos,
  compararHoras,
  generarSlots,
} from './utils/horaUtils';
export { resolverTarifa, type TarifaResuelta } from './utils/resolverTarifa';
