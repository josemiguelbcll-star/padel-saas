import { useSession } from '@/features/auth/useSession';

/**
 * Códigos canónicos de los módulos del sistema (0019). Coinciden con
 * `modulos.codigo` en la DB. Usá esta lista (en lugar de strings
 * sueltos) cuando llames a `useModuloHabilitado()` o
 * `clubTieneModulo()` para que un typo dispare error de TS en lugar
 * de fallar silenciosa en runtime.
 *
 * Si la lista de módulos cambia (DB + frontend), actualizar acá.
 */
export const MODULOS = {
  reservas: 'reservas',
  cuenta_turno: 'cuenta_turno',
  buffet: 'buffet',
  clases: 'clases',
  caja: 'caja',
  gastos: 'gastos',
  reportes: 'reportes',
  gestion_usuarios: 'gestion_usuarios',
  marca: 'marca',
} as const;

export type CodigoModulo = (typeof MODULOS)[keyof typeof MODULOS];

/**
 * Retorna `true` si el club del usuario logueado tiene activado el
 * módulo `codigo` en su plan asignado (0019).
 *
 * - Para un superadmin (no opera módulos de club): retorna `false`.
 * - Para un admin/vendedor de club: lee `modulosHabilitados` del
 *   SessionProvider, que viene del JOIN `clubes → plan_modulos →
 *   modulos`.
 *
 * En etapa 1, todos los clubes existentes están en plan 'pro' por
 * backfill (0019) → este hook retorna `true` para los 9 módulos. El
 * gating real se siente cuando se asignen planes diferenciados (etapa
 * posterior de venta de planes).
 *
 * IMPORTANTE: este hook NO es la barrera de seguridad — es UX/upsell.
 * La seguridad real va en las RLS de las tablas, vía el helper SQL
 * `current_club_has_modulo()`. Cuando una RLS use ese helper, un
 * vendedor que intenta hacer un UPDATE/INSERT/DELETE sin el módulo
 * en el plan recibe rechazo del backend, sin importar lo que retorne
 * este hook. (En etapa 1 ninguna RLS lo usa todavía.)
 */
export function useModuloHabilitado(codigo: CodigoModulo): boolean {
  const { modulosHabilitados, plataformaAdmin } = useSession();
  if (plataformaAdmin) return false;
  return modulosHabilitados.includes(codigo);
}
