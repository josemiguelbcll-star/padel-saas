import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Wallet,
  ShoppingCart,
  Package,
  Receipt,
  Bell,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * Sub-item de un NavItem. Vive bajo el item padre, indentado en el
 * sidebar. Hoy solo lo usa "Mostrador" para descomponer en Buffet/Shop
 * — son sub-vistas del mismo POS, filtradas por querystring `?linea=`.
 */
export interface NavSubItem {
  label: string;
  /** Path + search (ej. '/buffet?linea=buffet'). El highlight activo
   *  compara también el querystring, no solo el pathname. */
  to: string;
}

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** Sub-items siempre expandidos debajo del padre. */
  children?: NavSubItem[];
}

/**
 * Items del menú lateral.
 *
 * "Mostrador" se descompone visualmente en sub-items Buffet/Shop que
 * llevan al mismo POS con un filtro de línea pre-aplicado vía
 * querystring. El padre (sin querystring) muestra el POS sin filtrar.
 */
export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Reservas', to: '/reservas', icon: CalendarDays },
  { label: 'Jugadores', to: '/jugadores', icon: Users },
  { label: 'Caja', to: '/caja', icon: Wallet },
  {
    label: 'Mostrador',
    to: '/buffet',
    icon: ShoppingCart,
    children: [
      { label: 'Buffet', to: '/buffet?linea=buffet' },
      { label: 'Shop', to: '/buffet?linea=shop' },
    ],
  },
  { label: 'Inventario', to: '/inventario', icon: Package, disabled: true },
  { label: 'Gastos', to: '/gastos', icon: Receipt, disabled: true },
  { label: 'Alarmas', to: '/alarmas', icon: Bell, disabled: true },
  { label: 'Configuración', to: '/configuracion', icon: Settings },
];
