import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface CajaTab {
  label: string;
  to: string;
}

const tabs: CajaTab[] = [
  // Efectivo: el módulo de caja de siempre (apertura/cierre/arqueo).
  { label: 'Efectivo', to: '/app/caja/efectivo' },
  // Transferencias: reporte de cobros por transferencia por período.
  // Independiente del turno de caja (no requiere caja abierta).
  { label: 'Transferencias', to: '/app/caja/transferencias' },
];

/**
 * Layout de la sección Caja: barra de tabs horizontal + <Outlet />.
 *
 * Mismo lenguaje visual que ConfiguracionLayout (border-b, NavLink con
 * border-b-2 activo). NO incluye título propio: cada página hija trae su
 * header (CajaPage tiene el suyo "Caja"; TransferenciasPage el suyo) — así
 * CajaPage queda intacta y no se duplica el encabezado.
 *
 * react-router pone aria-current="page" en el NavLink activo automáticamente.
 */
export function CajaLayout() {
  return (
    <div className="space-y-6">
      <nav className="border-b border-border" aria-label="Secciones de caja">
        <ul className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex items-center border-b-2 px-3 py-2 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isActive
                      ? 'border-primary font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />
    </div>
  );
}
