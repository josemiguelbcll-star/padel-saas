// Feature "dashboard": KPIs y alarmas del día (banda "Hoy"). La lógica de
// datos vive acá; la UI la consume desde pages/DashboardPage.tsx.

// UI
export { BandaHoy } from './components/BandaHoy';

// Hooks (data logic)
export { useVentaDelDia, type VentaDelDia } from './hooks/useVentaDelDia';
export { useOcupacionHoy, type OcupacionHoy } from './hooks/useOcupacionHoy';
export {
  useProyeccionCierreHoy,
  type ProyeccionCierreHoy,
} from './hooks/useProyeccionCierreHoy';
export {
  useCobroPendienteHoy,
  type CobroPendienteHoy,
} from './hooks/useCobroPendienteHoy';
export {
  useProductosParaReponer,
  type ProductosParaReponer,
} from './hooks/useProductosParaReponer';

// Funciones puras + tipos (testeables)
export {
  horaAMinutos,
  esReservaFirme,
  saldoAlquiler,
  calcularOcupacion,
  calcularProyeccionCierre,
  turnosConCobroPendiente,
  type InsumosOcupacion,
  type ResultadoOcupacion,
  type ReservaSaldo,
  type ReservaCobro,
  type TurnoCobroPendiente,
  type ResultadoCobroPendiente,
} from './utils/kpisHoy';
