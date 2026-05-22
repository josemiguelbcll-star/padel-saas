import { TarifasPanel } from './TarifasPanel';
import { tarifasTurnosConfig } from './tarifasModuleConfig';

/**
 * Wrapper de compatibilidad — renderiza el panel de tarifas con la
 * config de TURNOS (comportamiento histórico).
 *
 * Usado por:
 *  - `StepTarifas.tsx` (wizard de onboarding) — siempre opera sobre
 *    tarifas de turnos, sin tabs.
 *  - `TarifasConfigPage.tsx` (ruta `/configuracion/tarifas`) — cuando
 *    el tab activo es Turnos.
 *
 * El acceso normal vía `/configuracion/tarifas` pasa por
 * `TarifasConfigPage` que monta tabs Turnos|Clases y renderiza el
 * panel con la config correspondiente.
 */
export function TarifasPage() {
  return <TarifasPanel config={tarifasTurnosConfig} />;
}
