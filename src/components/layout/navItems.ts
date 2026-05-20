import {
  LayoutDashboard,
  CalendarDays,
  Wallet,
  Coffee,
  Package,
  Receipt,
  Bell,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  disabled?: boolean;
}

/**
 * Items del menú lateral. En el Sprint 1 sólo Dashboard está habilitado;
 * el resto queda visible como hueco a llenar, con badge "Próx." para
 * indicar que viene en próximos sprints.
 */
export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Reservas', to: '/reservas', icon: CalendarDays, disabled: true },
  { label: 'Caja', to: '/caja', icon: Wallet, disabled: true },
  { label: 'Buffet', to: '/buffet', icon: Coffee, disabled: true },
  { label: 'Inventario', to: '/inventario', icon: Package, disabled: true },
  { label: 'Gastos', to: '/gastos', icon: Receipt, disabled: true },
  { label: 'Alarmas', to: '/alarmas', icon: Bell, disabled: true },
  { label: 'Configuración', to: '/configuracion', icon: Settings, disabled: true },
];
