import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useCajaAbierta } from './hooks/useCajaAbierta';

/**
 * Indicador de estado de caja en el header. Lee el estado REAL vía
 * useCajaAbierta (RPC current_club_caja_abierta, resuelta por modalidad del
 * club: por_dia = caja del club; por_vendedor = caja del usuario logueado).
 *
 * - ABIERTA → pill verde vistoso + punto con "latido en vivo" (ping + parpadeo
 *   de opacidad) que llama la atención. La animación está SIEMPRE activa (por
 *   pedido de UX: que el estado activo se note), no se frena con
 *   prefers-reduced-motion.
 * - CERRADA → pill gris/muted, sin animación.
 * - Cargando/error → pill neutro, sin pulse, sin afirmar estado.
 *
 * Siempre clickeable → /caja. Oculto en mobile (sm:inline-flex), como el
 * placeholder que reemplaza.
 */
export function CajaEstadoBadge() {
  const query = useCajaAbierta();

  // Cargando o error: pill neutro, no afirmamos abierta/cerrada.
  if (query.isLoading || query.error) {
    return (
      <div
        className="hidden items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline-flex"
        aria-label={query.error ? 'Estado de caja no disponible' : 'Estado de caja: cargando'}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        Caja: {query.error ? '—' : '…'}
      </div>
    );
  }

  const abierta = query.data != null;

  return (
    <NavLink
      to="/caja"
      aria-label={abierta ? 'Caja abierta — ir a Caja' : 'Caja cerrada — ir a Caja'}
      className={cn(
        'hidden items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors sm:inline-flex',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        abierta
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {abierta ? (
        // Punto "en vivo": halo (ping) que se expande + punto sólido que
        // parpadea (animate-latido). Siempre animado (UX: llamar la atención).
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 animate-latido rounded-full bg-emerald-500" />
        </span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
      )}
      Caja: {abierta ? 'abierta' : 'cerrada'}
    </NavLink>
  );
}
