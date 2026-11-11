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
  /**
   * Si TRUE, el sub-item solo se muestra a usuarios con rol 'admin'.
   * El filtro lo aplica el Sidebar; la seguridad real es server-side.
   */
  adminOnly?: boolean;
}

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  disabled?: boolean;
  /**
   * Clave del módulo de permisos que controla este item (ver `lib/permisos.ts`).
   * Si está presente, la visibilidad la decide SIEMPRE `getPermiso(user, modulo, 'ver')`
   * y `adminOnly` se ignora: lo que el admin concede en "Permisos del vendedor"
   * se respeta y no puede ser tapado por un gate de rol.
   */
  modulo?: string;
  /**
   * Si TRUE, el item solo se muestra a usuarios con rol 'admin'. El
   * filtro lo aplica el Sidebar (no se renderiza para no-admin). La
   * seguridad real es server-side (RLS + gate en RPCs) — esto es
   * cosmética del menú.
   *
   * IMPORTANTE: no uses `adminOnly` junto con `modulo`. Para módulos
   * configurables por permisos, usá `modulo` (los permisos mandan).
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
    modulo: 'reservas',
    children: [
      { label: 'Grilla del día', to: '/app/reservas', icon: CalendarClock },
      { label: 'Turnos fijos', to: '/app/turnos-fijos', icon: Repeat },
    ],
  },
  { label: 'Jugadores', to: '/app/jugadores', icon: Users, modulo: 'reservas' },
  { label: 'Noticias', to: '/app/noticias', icon: Smartphone, modulo: 'noticias' },
  {
    label: 'Caja',
    to: '/app/caja',
    icon: Wallet,
    modulo: 'caja',
    children: [
      { label: 'Efectivo', to: '/app/caja/efectivo', icon: Wallet },
      { label: 'Transferencias', to: '/app/caja/transferencias', icon: ArrowLeftRight },
      { label: 'Arqueo de Caja', to: '/app/caja/arqueos', icon: Receipt, adminOnly: true },
    ],
  },
  {
    label: 'Mostrador',
    to: '/app/buffet',
    icon: ShoppingCart,
    modulo: 'mostrador',
    children: [
      { label: 'Buffet', to: '/app/buffet?linea=buffet' },
      { label: 'Shop', to: '/app/buffet?linea=shop' },
    ],
  },
  {
    label: 'Finanzas',
    to: '/app/finanzas',
    icon: PieChart,
    modulo: 'finanzas',
    children: [
      { label: 'Flujo de caja', to: '/app/flujo-caja', icon: LineChart },
      { label: 'Gastos', to: '/app/gastos', icon: TrendingDown },
      { label: 'Ingresos', to: '/app/otros-ingresos', icon: TrendingUp },
      { label: 'Cuentas por pagar', to: '/app/cxp', icon: Receipt },
    ],
  },
  { label: 'Inventario', to: '/app/inventario', icon: Package, modulo: 'inventario' },
  { label: 'Configuración', to: '/app/configuracion', icon: Settings, modulo: 'configuracion' },
];
