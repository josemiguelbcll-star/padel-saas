import type { ComponentType, SVGProps } from 'react';
import { Ban, CircleDot, Hourglass, Pause } from 'lucide-react';
import type { EstadoClub } from '@/types/database';

/**
 * Chip coloreado para el estado del club (0019). Mapeo:
 *   - activo:     verde  (--estado-pagada).
 *   - trial:      ámbar  (--estado-senada).
 *   - suspendido: rojo   (--destructive).
 *   - baja:       gris   (--muted-foreground sobre --muted).
 *
 * Inline style con `hsl(var(--token) / X)` para variantes opacas —
 * mismo patrón validado contra el bug de cache de Tailwind con
 * utilidades dinámicas que ya usamos en PersonasTurnoSection,
 * ConsumosCatalogo, etc.
 */

interface EstadoConfig {
  label: string;
  fg: string;
  bg: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const ESTADO_CONFIG: Record<EstadoClub, EstadoConfig> = {
  activo: {
    label: 'Activo',
    fg: 'hsl(var(--estado-pagada))',
    bg: 'hsl(var(--estado-pagada) / 0.12)',
    Icon: CircleDot,
  },
  trial: {
    label: 'Trial',
    fg: 'hsl(var(--estado-senada))',
    bg: 'hsl(var(--estado-senada) / 0.12)',
    Icon: Hourglass,
  },
  suspendido: {
    label: 'Suspendido',
    fg: 'hsl(var(--destructive))',
    bg: 'hsl(var(--destructive) / 0.12)',
    Icon: Pause,
  },
  baja: {
    label: 'Baja',
    fg: 'hsl(var(--muted-foreground))',
    bg: 'hsl(var(--muted) / 0.6)',
    Icon: Ban,
  },
};

export function EstadoClubBadge({ estado }: { estado: EstadoClub }) {
  const cfg = ESTADO_CONFIG[estado];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      <cfg.Icon className="h-3 w-3" aria-hidden="true" />
      {cfg.label}
    </span>
  );
}
