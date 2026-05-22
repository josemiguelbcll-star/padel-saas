import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navItems, type NavItem, type NavSubItem } from './navItems';

/**
 * Sidebar fijo de escritorio. En mobile (<md) no se renderiza y el
 * AppShell expone el mismo contenido (SidebarBrand + SidebarNav) dentro
 * de un drawer.
 */
export function Sidebar() {
  return (
    <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-40 md:flex md:w-64 md:flex-col md:border-r md:border-border md:bg-card">
      <SidebarBrand />
      <SidebarNav />
    </aside>
  );
}

export function SidebarBrand() {
  return (
    <div className="flex h-14 items-center border-b border-border px-6">
      <span className="text-base font-semibold tracking-tight text-foreground">
        Padel SaaS
      </span>
    </div>
  );
}

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {navItems.map((item) => (
        <SidebarItem key={item.label} item={item} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

interface SidebarItemProps {
  item: NavItem;
  onNavigate?: () => void;
}

function SidebarItem({ item, onNavigate }: SidebarItemProps) {
  const Icon = item.icon;
  const location = useLocation();

  if (item.disabled) {
    return (
      <div
        role="link"
        aria-disabled="true"
        className="flex cursor-not-allowed select-none items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/90"
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Próx.
        </span>
      </div>
    );
  }

  // Si el item tiene sub-items, lo renderizamos junto con ellos
  // (sub-items siempre expandidos, indentados). El padre activo solo
  // cuando estás en su ruta SIN querystring de sub-item (porque los
  // sub-items usan querystrings para diferenciarse).
  const tieneSubitems = !!item.children && item.children.length > 0;

  return (
    <>
      <NavLink
        to={item.to}
        end
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            // Si tiene sub-items, el padre solo se marca activo cuando
            // estamos en la ruta SIN querystring (sino los sub-items
            // toman el highlight). isActive solo mira pathname, así que
            // refinamos con location.search.
            isActive && (!tieneSubitems || location.search === '')
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-foreground hover:bg-muted',
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
      </NavLink>

      {tieneSubitems && (
        <div className="mt-0.5 space-y-0.5 pl-7">
          {item.children!.map((sub) => (
            <SidebarSubItem
              key={sub.label}
              parentPath={item.to}
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
  /** Pathname del padre (ej. '/buffet'). Para comparar el active. */
  parentPath: string;
  sub: NavSubItem;
  onNavigate?: () => void;
}

function SidebarSubItem({
  parentPath,
  sub,
  onNavigate,
}: SidebarSubItemProps) {
  const location = useLocation();

  // El sub-item está activo cuando el pathname coincide con el padre
  // (porque sub.to incluye el mismo pathname) Y el search del browser
  // coincide con el querystring del sub. Comparamos los params
  // parseados (no el string crudo) para tolerar diferencias triviales.
  const subUrl = new URL(sub.to, window.location.origin);
  const isActive =
    location.pathname === parentPath &&
    location.search === subUrl.search;

  return (
    <NavLink
      to={sub.to}
      onClick={onNavigate}
      end
      className={cn(
        'block rounded-md px-3 py-1.5 text-[13px] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isActive
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {sub.label}
    </NavLink>
  );
}
