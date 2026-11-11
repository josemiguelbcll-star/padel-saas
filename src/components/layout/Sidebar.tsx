import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { navItems, type NavItem, type NavSubItem } from './navItems';
import { getPermiso } from '@/lib/permisos';

interface SidebarProps {
  /** Ancho reducido: solo iconos, sin labels ni sub-items. */
  collapsed?: boolean;
  onToggle?: () => void;
}

/**
 * Sidebar fijo de escritorio. En mobile (<md) no se renderiza y el
 * AppShell expone el mismo contenido (SidebarBrand + SidebarNav) dentro
 * de un drawer.
 */
export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        'hidden md:fixed md:inset-y-0 md:left-0 md:z-40 md:flex md:flex-col md:border-r md:border-border md:bg-card transition-[width] duration-200',
        collapsed ? 'md:w-16' : 'md:w-64',
      )}
    >
      <SidebarBrand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} />
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" />
              <span>Colapsar</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

export function SidebarBrand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        'flex h-14 items-center border-b border-border',
        collapsed ? 'justify-center px-2' : 'px-6',
      )}
    >
      <img src="/matchgo_logo.svg" alt="MatchGo" className="h-7 w-auto object-contain" />
    </div>
  );
}

interface SidebarNavProps {
  onNavigate?: () => void;
  collapsed?: boolean;
}

export function SidebarNav({ onNavigate, collapsed }: SidebarNavProps) {
  const { user } = useSession();
  const esAdmin = user?.rol === 'admin';
  const visibles = useMemo(() => {
    return navItems
      .filter((item) => {
        if (item.adminOnly && !esAdmin) return false;
        let moduloKey: string | null = null;
        if (item.label === 'Reservas' || item.label === 'Jugadores') moduloKey = 'reservas';
        else if (item.label === 'Noticias') moduloKey = 'noticias';
        else if (item.label === 'Caja') moduloKey = 'caja';
        else if (item.label === 'Mostrador') moduloKey = 'mostrador';
        else if (item.label === 'Finanzas') moduloKey = 'finanzas';
        else if (item.label === 'Inventario') moduloKey = 'inventario';
        else if (item.label === 'Configuración') moduloKey = 'configuracion';

        if (!moduloKey) return true; // Dashboard u otros
        return getPermiso(user, moduloKey, 'ver');
      })
      .map((item) => {
        // Filtrar sub-items adminOnly según el rol.
        if (!item.children) return item;
        return {
          ...item,
          children: item.children.filter((sub) => !sub.adminOnly || esAdmin),
        };
      });
  }, [user, esAdmin]);
  return (
    <nav
      className={cn(
        'flex-1 space-y-0.5 overflow-y-auto p-3',
        collapsed && 'px-2',
      )}
    >
      {visibles.map((item) => (
        <SidebarItem
          key={item.label}
          item={item}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      ))}
    </nav>
  );
}

/**
 * ¿Coincide la URL actual con la `to` del sub-item? Compara pathname
 * + search (lo que viene después de `?`). Sirve para que el padre se
 * desactive cuando un sub-item está activo (y evitar doble highlight).
 */
function subItemMatches(currentPathname: string, currentSearch: string, subTo: string): boolean {
  const url = new URL(subTo, window.location.origin);
  return currentPathname === url.pathname && currentSearch === url.search;
}

interface SidebarItemProps {
  item: NavItem;
  onNavigate?: () => void;
  collapsed?: boolean;
}

function SidebarItem({ item, onNavigate, collapsed }: SidebarItemProps) {
  const Icon = item.icon;
  const location = useLocation();

  if (item.disabled) {
    return (
      <div
        role="link"
        aria-disabled="true"
        className={cn(
          'flex cursor-not-allowed select-none items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/90',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!collapsed && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Próx.
          </span>
        )}
      </div>
    );
  }

  const tieneSubitems = !!item.children && item.children.length > 0;

  // Si tiene sub-items, el padre solo se marca activo cuando ningún
  // sub-item matchea la URL actual (sino tendríamos DOS items
  // resaltados al mismo tiempo). Funciona tanto para sub-items que
  // difieren por pathname como por querystring.
  const algunSubItemActivo =
    tieneSubitems &&
    item.children!.some((sub) =>
      subItemMatches(location.pathname, location.search, sub.to),
    );

  return (
    <>
      <NavLink
        to={item.to}
        end
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            collapsed && 'justify-center px-0',
            isActive && !algunSubItemActivo
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-foreground hover:bg-muted',
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>

      {/* En modo colapsado no mostramos sub-items (no entran en 64px). */}
      {!collapsed && tieneSubitems && (
        <div className="mt-0.5 space-y-0.5 pl-7">
          {item.children!.map((sub) => (
            <SidebarSubItem
              key={sub.label}
              sub={sub}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface SidebarSubItemProps {
  sub: NavSubItem;
  onNavigate?: () => void;
}

function SidebarSubItem({ sub, onNavigate }: SidebarSubItemProps) {
  const location = useLocation();
  const SubIcon = sub.icon;

  // El sub-item está activo cuando pathname Y search coinciden con el
  // sub.to. Comparamos los params parseados.
  const isActive = subItemMatches(location.pathname, location.search, sub.to);

  return (
    <NavLink
      to={sub.to}
      onClick={onNavigate}
      end
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isActive
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {SubIcon && <SubIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">{sub.label}</span>
    </NavLink>
  );
}
