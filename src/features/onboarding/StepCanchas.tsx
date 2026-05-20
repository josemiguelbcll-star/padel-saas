import { CanchasPage } from '@/features/configuracion';

/**
 * Paso 1 del wizard. Embebe directamente la pantalla de Configuración →
 * Canchas para reutilizar tabla, ABM, dialog y manejo de errores sin
 * duplicar nada.
 */
export function StepCanchas() {
  return <CanchasPage />;
}
