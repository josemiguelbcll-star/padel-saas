import { HorariosPage } from '@/features/configuracion';

/**
 * Paso 2 del wizard. Embebe directamente la pantalla de Configuración →
 * Horarios. Si el club todavía no configuró nada, el callout interno de
 * HorariosPage ya invita a completarlos.
 */
export function StepHorarios() {
  return <HorariosPage />;
}
