import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  Repeat,
  Users,
  Wallet,
  ArrowLeftRight,
  ShoppingCart,
  Package,
  PieChart,
  LineChart,
  TrendingDown,
  TrendingUp,
  Receipt,
  Bell,
  Settings,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

export interface NavSubItem {
  label: string;
  /** Path + search opcional (ej. '/buffet?linea=buffet'). El highlight
   *  activo compara también el querystring. */
  to: string;
  icon?: LucideIcon;
}

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  disabled?: boolean;
  /**
   * Si TRUE, el item solo se muestra a usuarios con rol 'admin'. El
   * filtro lo aplica el Sidebar (no se renderiza para no-admin). La
   * seguridad real es server-side (RLS + gate en RPCs) — esto es
   * cosmética del menú.
   */
  adminOnly?: boolean;
  /** Sub-items siempre expandidos debajo del padre. */
  children?: NavSubItem[];
}

/**
 * Items del menú lateral.
 *
 * "Mostrador" y "Finanzas" son padres con sub-items expandidos
 * (acordeón visual). Cada uno descompone visualmente una zona del
 * SaaS:
 *   - Mostrador → Buffet / Shop (vistas filtradas del POS).
 *   - Finanzas → Gastos / Otros ingresos (pantallas separadas).
 *
 * Gastos y Otros ingresos son cargables por admin Y vendedor (la RLS
 * server-side aplica). No los gateamos en el sidebar.
 */
export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/app', icon: LayoutDashboard },
  {
    label: 'Reservas',
    to: '/app/reservas',
    icon: CalendarDays,
    children: [
      { label: 'Grilla del día', to: '/app/reservas', icon: CalendarClock },
      { label: 'Turnos fijos', to: '/app/turnos-fijos', icon: Repeat },
    ],
  },
  { label: 'Jugadores', to: '/app/jugadores', icon: Users },
  { label: 'Noticias', to: '/app/noticias', icon: Smartphone },
  {
    label: 'Caja',
    to: '/app/caja',
    icon: Wallet,
    children: [
      { label: 'Efectivo', to: '/app/caja/efectivo', icon: Wallet },
      { label: 'Transferencias', to: '/app/caja/transferencias', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Mostrador',
    to: '/app/buffet',
    icon: ShoppingCart,
    children: [
      { label: 'Buffet', to: '/app/buffet?linea=buffet' },
      { label: 'Shop', to: '/app/buffet?linea=shop' },
    ],
  },
  {
    label: 'Finanzas',
    to: '/app/finanzas',
    icon: PieChart,
    children: [
      { label: 'Flujo de caja', to: '/app/flujo-caja', icon: LineChart },
      { label: 'Gastos', to: '/app/gastos', icon: TrendingDown },
      { label: 'Otros ingresos', to: '/app/otros-ingresos', icon: TrendingUp },
      { label: 'Cuentas por pagar', to: '/app/cxp', icon: Receipt },
    ],
  },
  { label: 'Inventario', to: '/app/inventario', icon: Package, adminOnly: true },
  { label: 'Alarmas', to: '/app/alarmas', icon: Bell, disabled: true },
  { label: 'Configuración', to: '/app/configuracion', icon: Settings },
];
