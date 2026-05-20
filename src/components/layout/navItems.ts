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
 * Items del menú lateral.
 *
 * Dashboard y Configuración están habilitados; el resto se va a habilitar
 * a medida que entren los módulos correspondientes (Reservas en sprint 3,
 * Caja/Buffet/etc. más adelante). Los disabled muestran un badge "Próx."
 * para que se vea que vienen pero todavía no se pueden tocar.
 */
export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Reservas', to: '/reservas', icon: CalendarDays },
  { label: 'Caja', to: '/caja', icon: Wallet, disabled: true },
  { label: 'Buffet', to: '/buffet', icon: Coffee, disabled: true },
  { label: 'Inventario', to: '/inventario', icon: Package, disabled: true },
  { label: 'Gastos', to: '/gastos', icon: Receipt, disabled: true },
  { label: 'Alarmas', to: '/alarmas', icon: Bell, disabled: true },
  { label: 'Configuración', to: '/configuracion', icon: Settings },
];
