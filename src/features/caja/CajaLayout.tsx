import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';

interface CajaTab {
  label: string;
  to: string;
  /** Si true, solo usuarios con rol 'admin' ven esta pestaña. */
  adminOnly?: boolean;
}

const tabs: CajaTab[] = [
  // Efectivo: el módulo de caja de siempre (apertura/cierre/arqueo).
  { label: 'Efectivo', to: '/app/caja/efectivo' },
  // Transferencias: reporte de cobros por transferencia por período.
  // Independiente del turno de caja (no requiere caja abierta).
  { label: 'Transferencias', to: '/app/caja/transferencias' },
  // Arqueo de Caja: historial de aperturas, cierres, arqueos y control de continuidad.
  // Solo admin (contiene datos sensibles de arqueo y diferencias).
  { label: 'Arqueo de Caja', to: '/app/caja/arqueos', adminOnly: true },
  // Auditoría completa de movimientos bancarios y tesorería de cuentas.
  // Solo admin.
  { label: 'Movimientos de Cuentas', to: '/app/caja/movimientos-cuentas', adminOnly: true },
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
  const { user } = useSession();
  const esAdmin = user?.rol === 'admin';
  const tabsVisibles = tabs.filter((tab) => !tab.adminOnly || esAdmin);

  return (
    <div className="space-y-6">
      <nav className="border-b border-border" aria-label="Secciones de caja">
        <ul className="flex flex-wrap gap-1">
          {tabsVisibles.map((tab) => (
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
